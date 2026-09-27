/** UI hint only; the remote HTTP gateway and SQLite enforce the actual write boundary. */
export function isRemoteReadOnly(): boolean {
  return process.env.NEXT_PUBLIC_REMOTE_READ_ONLY === "1";
}

export const REMOTE_READ_ONLY_MESSAGE =
  "원격 화면은 읽기 전용이에요. 변경은 맥미니 앱에서 해주세요.";
