import copy from '../../i18n/zh-CN.json';
const messages: Record<string, string> = {
  ENTRY_ROSTER_CHANGED:
    '房间成员已改变，请返回房间检查实际电脑数量；可继续手动管理或离开后重新设置。',
  NICKNAME_INVALID: '昵称需为1–12个字，不含控制字符。',
  ROOM_CODE_INVALID: '请输入6位有效房间码。',
  ROOM_FULL: '房间已满，请联系房主或选择其他房间。',
  ROOM_NOT_FOUND: '房间不存在或已关闭，请检查房间码。',
  ROOM_CLOSED: '房间已关闭，可以重新创建或加入。',
  ALREADY_SEATED: '你已在其他房间，请先返回原房间或离开。',
  ACK_UNCERTAIN: '确认尚未收到，结果不确定。请恢复连接后继续原设置。',
  STALE_STATE: '房间已更新。请查看当前座位后重试。',
  PERSISTENCE_UNAVAILABLE: '服务暂时无法保存，请稍后重试。',
  CONNECT_FAILED: '暂时连接不到服务，请稍后重试。',
  CONNECT_TIMEOUT: '连接超时，请稍后重试。',
  CONTROL_UNAVAILABLE: '当前连接不能操作，请先恢复。',
  SESSION_EXPIRED: '身份已过期，请重新建立访客身份。',
  ENTRY_IDENTITY_CHANGED: '身份已改变，原设置不能由当前身份继续。',
  ENTRY_CONTINUE_REQUIRED: '有未完成的设置，请先继续设置或返回已创建的房间。',
  SELF_RESTORE_REQUIRED: '本人席位尚未恢复，请重新连接后查看。',
  NOT_HOST: '只有当前房主可以管理房间。',
  RATE_LIMITED: '操作较快，请稍等后重试。',
};
export function roomErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  return messages[code] ?? copy.errors[code as keyof typeof copy.errors] ?? copy.genericFailure;
}
