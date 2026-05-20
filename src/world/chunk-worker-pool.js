const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

function getDefaultWorkerCount() {
  const parallelism = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;

  return Math.max(1, Math.min(4, parallelism - 1));
}

function createChunkWorkerPool(options = {}) {
  const workerCount = Math.max(1, options.workerCount ?? getDefaultWorkerCount());
  const workerScript = options.workerScript ?? path.join(__dirname, 'chunk-generation-worker.js');
  const workers = [];
  const queue = [];
  const pendingJobs = new Map();
  let nextJobId = 1;
  let closed = false;

  function dispatch(workerState) {
    if (closed || workerState.busy || queue.length === 0) {
      return;
    }

    const job = queue.shift();
    workerState.busy = true;
    workerState.jobId = job.jobId;
    pendingJobs.set(job.jobId, {
      reject: job.reject,
      resolve: job.resolve,
      workerState
    });
    workerState.worker.postMessage(job.payload);
  }

  function onJobComplete(jobId, result, error = null) {
    const pending = pendingJobs.get(jobId);

    if (!pending) {
      return;
    }

    pendingJobs.delete(jobId);
    pending.workerState.busy = false;
    pending.workerState.jobId = null;

    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(result);
    }

    dispatch(pending.workerState);
  }

  for (let index = 0; index < workerCount; index++) {
    const worker = new Worker(workerScript);
    const workerState = {
      busy: false,
      jobId: null,
      worker
    };

    worker.on('message', (message) => {
      if (message?.error) {
        onJobComplete(message.jobId, null, new Error(message.error));
        return;
      }

      onJobComplete(message.jobId, message);
    });

    worker.on('error', (error) => {
      const activeJobId = workerState.jobId;

      if (activeJobId !== null) {
        onJobComplete(activeJobId, null, error);
      }
    });

    workers.push(workerState);
  }

  function generateChunk(payload) {
    if (closed) {
      return Promise.reject(new Error('Chunk worker pool is closed.'));
    }

    const jobId = nextJobId++;

    return new Promise((resolve, reject) => {
      queue.push({
        jobId,
        payload: {
          ...payload,
          jobId
        },
        reject,
        resolve
      });

      for (const workerState of workers) {
        dispatch(workerState);
      }
    });
  }

  async function close() {
    if (closed) {
      return;
    }

    closed = true;

    while (queue.length > 0) {
      const job = queue.shift();
      job.reject(new Error('Chunk worker pool closed before task started.'));
    }

    for (const [jobId, pending] of pendingJobs.entries()) {
      pendingJobs.delete(jobId);
      pending.reject(new Error('Chunk worker pool closed before task completed.'));
    }

    await Promise.all(workers.map(({ worker }) => worker.terminate().catch(() => {})));
  }

  return {
    close,
    generateChunk
  };
}

module.exports = {
  createChunkWorkerPool
};
