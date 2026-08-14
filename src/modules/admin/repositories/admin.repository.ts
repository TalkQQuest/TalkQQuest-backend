// modules/admin/repositories/admin.repository.ts
import { prisma } from "../../../config/database";

// Admin_Users는 Users에 role 컬럼을 두는 대신 분리한 테이블이다(#208) —
// 이 행이 있으면 관리자다. 승격은 API로 노출하지 않고 DB에 직접 넣는 방식만 쓴다.
export const isAdminUser = async (userId: string): Promise<boolean> => {
  const admin = await prisma.admin_Users.findUnique({
    where: { user_id: userId },
    select: { id: true },
  });
  return admin !== null;
};
