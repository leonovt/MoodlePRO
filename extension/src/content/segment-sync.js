/**
 * Segments are appended in start-time order as they stream in over the WebSocket.
 * Binary search for the last segment whose start <= currentTime.
 */
export function findActiveSegmentIndex(segments, currentTime) {
  let lo = 0;
  let hi = segments.length - 1;
  let answer = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= currentTime) {
      answer = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return answer;
}
