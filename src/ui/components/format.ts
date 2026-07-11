const MAX_FORMAT_CACHE_ENTRIES = 10000;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric"
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const dateLabelCache = new Map<number, string>();
const dateTimeLabelCache = new Map<number, string>();

export function formatDate(timestamp: number): string {
  return getCachedDateLabel(dateLabelCache, timestamp, dateFormatter);
}

export function formatDateTime(timestamp: number): string {
  return getCachedDateLabel(dateTimeLabelCache, timestamp, dateTimeFormatter);
}

function getCachedDateLabel(
  cache: Map<number, string>,
  timestamp: number,
  formatter: Intl.DateTimeFormat
): string {
  const cached = cache.get(timestamp);
  if (cached !== undefined) {
    return cached;
  }

  const label = formatter.format(new Date(timestamp));
  cache.set(timestamp, label);

  if (cache.size > MAX_FORMAT_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }

  return label;
}
