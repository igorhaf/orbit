"""
Priority Job Executor
PROMPT #120 - Job Priority System
PROMPT #191 - Run jobs in separate threads to avoid blocking FastAPI event loop

Manages concurrent execution of background jobs with priority ordering.
Higher priority jobs get the next available execution slot when concurrency
is at capacity.

Architecture:
- asyncio.PriorityQueue ensures highest-priority jobs are dequeued first
- asyncio.Semaphore limits concurrent executions (default=3)
- Workers run forever, consuming from the queue
- Each job runs in a dedicated thread with its own event loop,
  preventing blocking I/O (os.walk, file reads) from freezing the server
- Singleton pattern ensures one executor per process
"""

import asyncio
import logging
import threading
from typing import Callable, Any

logger = logging.getLogger(__name__)


class PriorityJobExecutor:
    """
    Singleton executor that runs background jobs respecting priority.

    Usage:
        executor = PriorityJobExecutor.get_instance()
        await executor.submit(priority=10, coro_func=my_async_fn, arg1, arg2)

    Priority values (higher = runs first):
        CRITICAL = 10  (interview responses)
        HIGH     = 7   (wizard steps)
        NORMAL   = 5   (user-triggered)
        LOW      = 3   (background generation)
    """

    _instance = None

    def __init__(self, max_concurrent: int = 3):
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._workers_started = False
        self._counter = 0  # Tiebreaker for equal priorities (FIFO within same priority)
        # PROMPT #243 - Pause/Resume support
        self._paused = False
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # Start unpaused (set = running)

    @classmethod
    def get_instance(cls, max_concurrent: int = 3) -> "PriorityJobExecutor":
        """Get or create the singleton executor instance."""
        if cls._instance is None:
            cls._instance = cls(max_concurrent=max_concurrent)
        return cls._instance

    async def submit(self, priority: int, coro_func: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        """
        Submit a coroutine function for priority-ordered execution.

        Args:
            priority: Job priority (higher value = higher priority)
            coro_func: Async function to execute
            *args: Positional arguments for coro_func
            **kwargs: Keyword arguments for coro_func
        """
        # Negate priority so PriorityQueue (min-heap) pops highest priority first
        # Use counter as tiebreaker for FIFO within same priority level
        self._counter += 1
        await self._queue.put((-priority, self._counter, coro_func, args, kwargs))

        logger.debug(f"Job queued with priority={priority}, queue_size={self._queue.qsize()}")

        # Start workers on first submission
        if not self._workers_started:
            self._start_workers()

    def pause(self) -> None:
        """Pause the executor. Running jobs finish, but no new jobs start."""
        self._paused = True
        self._pause_event.clear()
        logger.info("Job executor PAUSED - no new jobs will start")

    def resume(self) -> None:
        """Resume the executor. Queued jobs start processing again."""
        self._paused = False
        self._pause_event.set()
        logger.info("Job executor RESUMED - jobs will start processing")

    @property
    def is_paused(self) -> bool:
        return self._paused

    @property
    def queue_size(self) -> int:
        return self._queue.qsize()

    def _start_workers(self) -> None:
        """Start worker coroutines that consume from the priority queue."""
        self._workers_started = True
        for i in range(self._max_concurrent):
            asyncio.create_task(self._worker(i))
        logger.info(f"Started {self._max_concurrent} priority job workers")

    def _run_in_thread(self, coro_func: Callable[..., Any], args: tuple, kwargs: dict) -> None:
        """
        Run an async function in a dedicated thread with its own event loop.

        PROMPT #191 - This prevents blocking I/O operations (os.walk, file reads,
        synchronous DB queries) inside async jobs from freezing the main FastAPI
        event loop, which would make the entire server unresponsive.
        """
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(coro_func(*args, **kwargs))
        finally:
            loop.close()

    async def _worker(self, worker_id: int) -> None:
        """Worker loop: dequeue jobs and execute them in separate threads."""
        while True:
            try:
                # PROMPT #243 - Wait if paused (blocks here until resumed)
                await self._pause_event.wait()
                neg_priority, counter, coro_func, args, kwargs = await self._queue.get()
                priority = -neg_priority

                async with self._semaphore:
                    func_name = getattr(coro_func, '__name__', str(coro_func))
                    logger.info(f"Worker-{worker_id} executing {func_name} (priority={priority}) in thread")
                    try:
                        # PROMPT #191 - Run in separate thread to avoid blocking FastAPI
                        loop = asyncio.get_event_loop()
                        await loop.run_in_executor(
                            None,  # Use default ThreadPoolExecutor
                            self._run_in_thread,
                            coro_func,
                            args,
                            kwargs or {}
                        )
                    except Exception as e:
                        logger.error(f"Worker-{worker_id} job failed: {func_name} - {e}")
                    finally:
                        self._queue.task_done()

            except asyncio.CancelledError:
                logger.info(f"Worker-{worker_id} cancelled")
                break
            except Exception as e:
                logger.error(f"Worker-{worker_id} unexpected error: {e}")
