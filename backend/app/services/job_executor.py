"""
Priority Job Executor
PROMPT #120 - Job Priority System

Manages concurrent execution of background jobs with priority ordering.
Higher priority jobs get the next available execution slot when concurrency
is at capacity.

Architecture:
- asyncio.PriorityQueue ensures highest-priority jobs are dequeued first
- asyncio.Semaphore limits concurrent executions (default=3)
- Workers run forever, consuming from the queue
- Singleton pattern ensures one executor per process
"""

import asyncio
import logging
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

    def _start_workers(self) -> None:
        """Start worker coroutines that consume from the priority queue."""
        self._workers_started = True
        for i in range(self._max_concurrent):
            asyncio.create_task(self._worker(i))
        logger.info(f"Started {self._max_concurrent} priority job workers")

    async def _worker(self, worker_id: int) -> None:
        """Worker loop: dequeue jobs and execute them with semaphore control."""
        while True:
            try:
                neg_priority, counter, coro_func, args, kwargs = await self._queue.get()
                priority = -neg_priority

                async with self._semaphore:
                    func_name = getattr(coro_func, '__name__', str(coro_func))
                    logger.info(f"Worker-{worker_id} executing {func_name} (priority={priority})")
                    try:
                        await coro_func(*args, **kwargs)
                    except Exception as e:
                        logger.error(f"Worker-{worker_id} job failed: {func_name} - {e}")
                    finally:
                        self._queue.task_done()

            except asyncio.CancelledError:
                logger.info(f"Worker-{worker_id} cancelled")
                break
            except Exception as e:
                logger.error(f"Worker-{worker_id} unexpected error: {e}")
