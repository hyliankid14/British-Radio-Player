export function redirectSystemPath({
  path,
  initial
}: {
  path: string;
  initial: boolean;
}): string {
  if (path.includes("notification.click")) {
    return "/modal/now-playing";
  }
  return path;
}
