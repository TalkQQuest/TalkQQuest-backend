jest.mock("../../modules/admin/repositories/admin.repository");

import { Request, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors/common.error";
import * as adminRepository from "../../modules/admin/repositories/admin.repository";
import { authorizeAdmin } from "../auth";

const mockedAdminRepo = jest.mocked(adminRepository);

const buildReq = (userId?: string) => ({ user: userId ? { id: userId, email: null } : undefined }) as Request;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("authorizeAdmin", () => {
  it("Admin_Users에 행이 있으면 통과시킨다", async () => {
    mockedAdminRepo.isAdminUser.mockResolvedValue(true);
    const next = jest.fn();

    await authorizeAdmin()(buildReq("u1"), {} as Response, next);

    expect(mockedAdminRepo.isAdminUser).toHaveBeenCalledWith("u1");
    expect(next).toHaveBeenCalledWith();
  });

  it("Admin_Users에 행이 없으면 403 ForbiddenError로 막는다", async () => {
    mockedAdminRepo.isAdminUser.mockResolvedValue(false);
    const next = jest.fn();

    await authorizeAdmin()(buildReq("u1"), {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  // authorizeUser() 뒤에 이어 붙이는 게 정상 사용이지만, 순서가 바뀌어 req.user가 없는
  // 상태로 호출돼도 DB 조회 없이 401로 막는다.
  it("req.user가 없으면(인증 미들웨어보다 먼저 실행됨) DB 조회 없이 401을 던진다", async () => {
    const next = jest.fn();

    await authorizeAdmin()(buildReq(), {} as Response, next);

    expect(mockedAdminRepo.isAdminUser).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("조회 중 에러가 나면 그대로 next에 전달한다", async () => {
    const dbError = new Error("db down");
    mockedAdminRepo.isAdminUser.mockRejectedValue(dbError);
    const next = jest.fn();

    await authorizeAdmin()(buildReq("u1"), {} as Response, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});
