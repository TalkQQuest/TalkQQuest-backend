import { NotFoundError } from "../../../shared/errors/common.error";
import * as userRepository from "../repositories/user.repository";
import { MyProfileResponseDto, UpdateProfileRequestDto } from "../dtos/user-profile.dto";

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
