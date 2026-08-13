jest.mock("../repositories/user.repository");

import * as userRepository from "../repositories/user.repository";
import { getMyProfile } from "../services/user-profile.service";
import { NotFoundError } from "../../../shared/errors/common.error";

const mockedRepo = jest.mocked(userRepository);

beforeEach(() => {
  jest.clearAllMocks();
});

const baseProfile = {
  nickname: "닉네임",
  avatar_url: null,
  bio: null,
  level: 1,
  xp: 0,
  daily_conversation_goal: 1,
  onboarding_completed: false,
  personality_type: null,
  difficult_situations: null,
  purpose: null,
  preferred_style: null,
  interests: null,
};

// #190 — 온보딩에서 저장한 값(personality_type/difficult_situations/purpose/preferred_style/
// interests)을 다시 읽어올 수 있는 경로가 없던 문제. GET /users/me 응답에 그대로 노출한다.
describe("getMyProfile — 온보딩 선택값 노출(#190)", () => {
  it("존재하지 않는 유저면 거부한다", async () => {
    mockedRepo.findUserWithProfile.mockResolvedValue(null);

    await expect(getMyProfile("u1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("온보딩 전(값이 전부 비어있음)이면 null/빈 배열로 응답한다", async () => {
    mockedRepo.findUserWithProfile.mockResolvedValue({
      id: "u1",
      name: "홍길동",
      user_profile: baseProfile,
    } as never);

    const result = await getMyProfile("u1");

    expect(result.personalityType).toBeNull();
    expect(result.difficultSituations).toEqual([]);
    expect(result.purpose).toEqual([]);
    expect(result.preferredStyle).toBeNull();
    expect(result.interests).toEqual([]);
  });

  it("온보딩에서 저장한 값을 그대로 반환한다", async () => {
    mockedRepo.findUserWithProfile.mockResolvedValue({
      id: "u1",
      name: "홍길동",
      user_profile: {
        ...baseProfile,
        personality_type: "introvert",
        difficult_situations: ["낯가림", "직접 입력한 어려운 점"],
        purpose: ["자신감 키우기", "말문 트기"],
        preferred_style: "차분한 스타일",
        interests: ["영화", "운동"],
      },
    } as never);

    const result = await getMyProfile("u1");

    expect(result.personalityType).toBe("introvert");
    expect(result.difficultSituations).toEqual(["낯가림", "직접 입력한 어려운 점"]);
    expect(result.purpose).toEqual(["자신감 키우기", "말문 트기"]);
    expect(result.preferredStyle).toBe("차분한 스타일");
    expect(result.interests).toEqual(["영화", "운동"]);
  });

  it("Json 필드 형식이 깨져 있으면(배열 아님) 빈 배열로 안전 처리한다", async () => {
    mockedRepo.findUserWithProfile.mockResolvedValue({
      id: "u1",
      name: "홍길동",
      user_profile: { ...baseProfile, difficult_situations: "잘못된형식", purpose: { a: 1 } },
    } as never);

    const result = await getMyProfile("u1");

    expect(result.difficultSituations).toEqual([]);
    expect(result.purpose).toEqual([]);
  });
});
