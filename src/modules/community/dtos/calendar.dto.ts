import { z } from "zod";

export interface AddCalendarEventRequestDto {
    communityId: string;
}

export const addCalendarEventRequestSchema = z.object({
    communityId: z.string().uuid(),
}) satisfies z.ZodType<AddCalendarEventRequestDto>;

export interface AddCalendarEventResponseDto {
    eventId: string;
    title: string;
    startedAt: string;
}
