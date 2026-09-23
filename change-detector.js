export function shouldNotifyForInventoryChange(lastKnown, latestTimestamp) {
  if (!latestTimestamp) {
    return false;
  }

  if (!lastKnown) {
    return false;
  }

  return Number(latestTimestamp) > Number(lastKnown);
}
