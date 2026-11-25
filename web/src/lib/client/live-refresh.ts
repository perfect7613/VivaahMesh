/** Refresh immediately and collapse bursts into at most one more refresh per interval. */
export function coalesceChanges(refresh: () => void, interval = 1000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;

  function run() {
    pending = false;
    timer = setTimeout(() => {
      timer = undefined;
      if (pending) run();
    }, interval);
    refresh();
  }

  return {
    notify() {
      if (timer === undefined) run();
      else pending = true;
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = false;
    },
  };
}
