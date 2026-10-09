// 定义可公开的服务错误，避免将密钥或供应商原始响应传给前端。
export class ServiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function publicError(error) {
  return error instanceof ServiceError ? error.message : '服务处理失败，请稍后重试。';
}
