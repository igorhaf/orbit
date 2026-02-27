# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um ANALISTA DE NEGÓCIOS experiente analisando código-fonte para extrair regras de negócio FUNCIONAIS.

Sua perspectiva é de NEGÓCIO, não de tecnologia. Imagine que você está escrevendo um documento
para o GERENTE DE PRODUTO ou DONO DO NEGÓCIO que não entende código.

EXTRAIA regras que respondam:
- O que o USUÁRIO pode ou não pode fazer?
- Quais são as PERMISSÕES e RESTRIÇÕES de acesso?
- Como funcionam os FLUXOS e PROCESSOS do sistema?
- Quais CÁLCULOS de negócio existem (preços, comissões, notas)?
- Quais LIMITES e QUOTAS o sistema impõe?
- Quais VALIDAÇÕES afetam a experiência do usuário?
- Como as ENTIDADES do negócio se relacionam?

IGNORE COMPLETAMENTE (não são regras de negócio):
- Tipos de campos (booleano, string, integer)
- Configurações de framework (drivers, sessões, guards, middleware)
- Detalhes de banco (foreign keys, NOT NULL, migrations)
- CSS, layout, estilização
- Logs, cache, filas, timeouts
- Imports, dependências, bibliotecas
- Configurações de ambiente (.env, configs)
- Código boilerplate ou padrões técnicos

FORMATO das regras (escreva como linguagem de negócio):
✅ BOM: "O aluno só pode avaliar um curso após completar pelo menos 50% das aulas"
✅ BOM: "O instrutor recebe 70% do valor de cada inscrição em seu curso"
✅ BOM: "Cupons de desconto expiram após a data limite definida pelo instrutor"
❌ RUIM: "O campo 'rating' deve ser um integer entre 1 e 5"
❌ RUIM: "A tabela enrollments tem foreign key para courses"
❌ RUIM: "O guard 'web' usa driver de sessão"

Responda APENAS em JSON válido, sem markdown, sem explicações adicionais.

## User Prompt

Arquivo: backend/app/services/job_executor.py
Linguagem: python

```
"""
Priority Job Executor
PROMPT #120 - Job Priority System
PROMPT #191 - Run jobs in separate threads to avoid blocking FastAPI event loop
PROMPT #283 - Dedicated CRITICAL worker + preemption for real-time interviews

Manages concurrent execution of background jobs with priority ordering.
Higher priority jobs get the next available execution slot when concurrency
is at capacity.

Architecture:
- Dual-queue: separate queue for CRITICAL jobs (priority >= 10)
- Dedicated CRITICAL worker runs interview/chat jobs immediately (never waits)
- Regular workers (3) handle all other jobs from the main priority queue
- When a CRITICAL job starts, regular workers are paused to free Ollama GPU
- After CRITICAL job finishes, regular workers resume automatically
- Each job runs in a dedicated thread with its own event loop
- Singleton pattern ensures one executor per process
"""

import asyncio
import logging
import threading
from typing import Callable, Any

logger = logging.getLogger(__name__)

# Priority threshold: jobs with priority >= this get the dedicated worker
CRITICAL_THRESHOLD = 10


class PriorityJobExecutor:
    """
    Singleton executor with dedicated CRITICAL worker for real-time responses.

    Usage:
        executor = PriorityJobExecutor.get_instance()
        await executor.submit(priority=10, coro_func=my_async_fn, arg1, arg2)

    Priority values (higher = runs first):
        CRITICAL = 10  (interview/chat responses → dedicated worker)
        HIGH     = 7   (wizard steps)
        NORMAL   = 5   (user-triggered)
        LOW      = 3   (background generation)
    """

    _instance = None

    def __init__(self, max_concurrent: int = 8):
        # PROMPT #288 - Increased from 3 to 8 workers for better throughput
        # Regular queue for non-critical jobs
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        # Dedicated queue for CRITICAL jobs (interviews, chats)
        self._critical_queue: asyncio.PriorityQueue = asyncio.PriorityQueue()

        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._workers_started = False
        self._counter = 0  # Tiebreaker for equal priorities (FIFO within same priority)

        # PROMPT #243 - Pause/Resume support for regular workers
        self._paused = False
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # Start unpaused (set = running)

        # PROMPT #283 - Track active critical jobs for preemption
        self._active_critical_count = 0
        self._critical_lock = asyncio.Lock()

    @classmethod
    def get_instance(cls, max_concurrent: int = 8) -> "PriorityJobExecutor":
        """Get or create the singleton executor instance."""
        if cls._instance is None:
            cls._instance = cls(max_concurrent=max_concurrent)
        return cls._instance

    async def submit(self, priority: int, coro_func: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        """
        Submit a coroutine function for priority-ordered execution.

        CRITICAL jobs (priority >= 10) go to the dedicated worker queue
        and preempt regular workers to free GPU resources.

        Args:
            priority: Job priority (higher value = higher priority)
            coro_func: Async function to execute
            *args: Positional arguments for coro_func
            **kwargs: Keyword arguments for coro_func
        """
        self._counter += 1

        if priority >= CRITICAL_THRESHOLD:
            # CRITICAL: dedicated queue → runs immediately, never waits
            await self._critical_queue.put((-priority, self._counter, coro_func, args, kwargs))
            logger.info(f"CRITICAL job queued (priority={priority}), critical_queue_size={self._critical_queue.qsize()}")
        else:
            # Regular: standard priority queue
            await self._queue.put((-priority, self._counter, coro_func, args, kwargs))
            logger.debug(f"Job queued with priority={priority}, queue_size={self._queue.qsize()}")

        # Start workers on first submission
        if not self._workers_started:
            self._start_workers()

    def pause(self) -> None:
        """Pause regular workers. Running jobs finish, but no new jobs start."""
        self._paused = True
        self._pause_event.clear()
        logger.info("Regular workers PAUSED - no new regular jobs will start")

    def resume(self) -> None:
        """Resume regular workers. Queued jobs start processing again."""
        self._paused = False
        self._pause_event.set()
        logger.info("Regular workers RESUMED - jobs will start processing")

    _shutting_down = False

    def shutdown(self) -> None:
        """
        PROMPT #226 - Graceful shutdown: signal workers to stop and clear queues.
        Called from main.py lifespan shutdown.
        """
        PriorityJobExecutor._shutting_down = True
        logger.info("PriorityJobExecutor shutting down...")

        # Drain queues to prevent new work
        drained = 0
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
                drained += 1
            except asyncio.QueueEmpty:
                break
        while not self._critical_queue.empty():
            try:
                self._critical_queue.get_nowait()
                drained += 1
            except asyncio.QueueEmpty:
                break

        # Resume paused workers so they can exit their loops
        self._pause_event.set()
        self._workers_started = False

        if drained > 0:
            logger.info(f"Drained {drained} queued jobs during shutdown")
        logger.info("PriorityJobExecutor shutdown complete")

    @classmethod
    def is_shutting_down(cls) -> bool:
        return cls._shutting_down

    @property
    def is_paused(self) -> bool:
        return self._paused

    @property
    def queue_size(self) -> int:
        return self._queue.qsize()

    @property
    def critical_queue_size(self) -> int:
        return self._critical_queue.qsize()

    def _start_workers(self) -> None:
        """Start worker coroutines: regular workers + dedicated critical worker."""
        self._workers_started = True

        # Regular workers (handle non-critical jobs)
        for i in range(self._max_concurrent):
            asyncio.create_task(self._worker(i))

        # Dedicated CRITICAL worker (handles interviews/chats immediately)
        asyncio.create_task(self._critical_worker())

        logger.info(
            f"Started {self._max_concurrent} regular workers + 1 dedicated CRITICAL worker"
        )

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

    async def _critical_worker(self) -> None:
        """
        Dedicated worker for CRITICAL jobs (interviews, chats).

        PROMPT #283 - This worker:
        1. Runs independently from regular workers (never blocked by them)
        2. Pauses regular workers when a CRITICAL job starts (frees Ollama GPU)
        3. Resumes regular workers after CRITICAL job completes
        4. Ensures real-time response times for user-facing interactions
        """
        while not PriorityJobExecutor._shutting_down:
            try:
                neg_priority, counter, coro_func, args, kwargs = await self._critical_queue.get()
                priority = -neg_priority

                func_name = getattr(coro_func, '__name__', str(coro_func))
                logger.info(
                    f"CRITICAL-Worker executing {func_name} (priority={priority}) - "
                    f"pausing regular workers for GPU priority"
                )

                # Preempt: pause regular workers so Ollama GPU is freed
                async with self._critical_lock:
                    self._active_critical_count += 1
                    if self._active_critical_count == 1:
                        # First critical job → pause regular workers
                        self._pause_event.clear()
                        logger.info("Regular workers PAUSED (CRITICAL job preemption)")

                try:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(
                        None,
                        self._run_in_thread,
                        coro_func,
                        args,
                        kwargs or {}
                    )
                except Exception as e:
                    logger.error(f"CRITICAL-Worker job failed: {func_name} - {e}")
                finally:
                    self._critical_queue.task_done()

                    # Resume regular workers if no more critical jobs
                    async with self._critical_lock:
                        self._active_critical_count -= 1
                        if self._active_critical_count == 0 and not self._paused:
                            self._pause_event.set()
                            logger.info("Regular workers RESUMED (CRITICAL job done)")

            except asyncio.CancelledError:
                logger.info("CRITICAL-Worker cancelled")
                break
            except Exception as e:
                logger.error(f"CRITICAL-Worker unexpected error: {e}")

    async def _worker(self, worker_id: int) -> None:
        """Worker loop: dequeue regular jobs and execute them in separate threads."""
        while not PriorityJobExecutor._shutting_down:
            try:
                # Wait if paused (blocks here until resumed or critical job done)
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

```

Extraia as regras de negócio FUNCIONAIS deste arquivo.
Escreva cada regra como se explicasse para um GERENTE DE PRODUTO.
Responda em JSON com este formato exato:

{
  "business_rules": [
    {
      "rule_text": "Descrição funcional da regra em linguagem de negócio",
      "rule_type": "domain|validation|constraint|workflow|permission|calculation",
      "confidence": "high|medium|low",
      "source_context": "trecho relevante do código (max 100 chars)"
    }
  ],
  "entities_found": ["Entidade1", "Entidade2"],
  "file_purpose": "Breve descrição do propósito do arquivo (1 frase)",
  "file_layer": "schema|routes|logic|presentation|config"
}

Se não houver regras de negócio FUNCIONAIS, retorne: {"business_rules": [], "entities_found": [], "file_purpose": "..."}
Arquivos de configuração, estilização e infraestrutura geralmente NÃO contêm regras de negócio.

## Response


