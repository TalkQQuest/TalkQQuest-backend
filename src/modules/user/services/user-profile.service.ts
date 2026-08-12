import { NotFoundError } from "../../../shared/errors/common.error";
import * as userRepository from "../repositories/user.repository";
import { MyProfileResponseDto, UpdateProfileRequestDto } from "../dtos/user-profile.dto";

// Json 컬럼(difficult_situations/purpose/interests)을 안전하게 string[]로 변환한다.
// 값이 없거나 형식이 다르면 빈 배열 (archive.service.ts의 toSummaryChips와 같은 패턴).
const toStringArray = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];

export const getMyProfile = async (userId: string): Promise<MyProfileResponseDto> => {
  const user = await userRepository.findUserWithProfile(userId);
  if (!user || !user.user_profile) {
    throw new NotFoundError("사용자를 찾을 수 없습니다.");
  }

  const profile = user.user_profile;
  return {
    id: user.id,
    name: user.name,
    nickname: profile.nickname,
    avatarUrl: profile.avatar_url,
    bio: profile.bio,
    level: profile.level,
    xp: profile.xp,
    dailyConversationGoal: profile.daily_conversation_goal,
    onboardingCompleted: profile.onboarding_completed,
    // #190 — 온보딩에서 저장한 선택값을 다시 조회할 수 있는 경로가 없었어서 추가.
    personalityType: profile.personality_type,
    difficultSituations: toStringArray(profile.difficult_situations),
    purpose: toStringArray(profile.purpose),
    preferredStyle: profile.preferred_style,
    interests: toStringArray(profile.interests),
  };
};

export const updateMyProfile = async (userId: string, body: UpdateProfileRequestDto): Promise<void> => {
  const profile = await userRepository.findProfileByUserId(userId);
  if (!profile) {
    throw new NotFoundError("사용자를 찾을 수 없습니다.");
  }

  await userRepository.updateProfile(userId, {
    ...(body.nickname !== undefined && { nickname: body.nickname }),
    ...(body.avatarUrl !== undefined && { avatar_url: body.avatarUrl }),
    ...(body.bio !== undefined && { bio: body.bio }),
    ...(body.dailyConversationGoal !== undefined && {
      daily_conversation_goal: body.dailyConversationGoal,
    }),
    ...(body.preferredStyle !== undefined && { preferred_style: body.preferredStyle }),
    ...(body.interests !== undefined && { interests: body.interests }),
  });
};

export const withdrawUser = async (userId: string): Promise<void> => {
  const user = await userRepository.findUserWithProfile(userId);
  if (!user) {
    throw new NotFoundError("사용자를 찾을 수 없습니다.");
  }

  await userRepository.softDeleteUser(userId);
};