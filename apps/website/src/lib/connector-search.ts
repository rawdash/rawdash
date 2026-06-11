export function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function syncQueryParam(value: string): void {
  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set('q', value);
  } else {
    url.searchParams.delete('q');
  }
  history.replaceState(null, '', url);
}
