export class AppError extends Error {
  /** 创建携带 HTTP 状态码和稳定错误码的业务异常。 */
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "BAD_REQUEST"
  ) {
    super(message);
    this.name = "AppError";
  }
}
