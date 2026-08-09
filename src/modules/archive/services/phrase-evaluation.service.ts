// 저장한 문장에 대해 AI가 평가 메모 + 태그 칩 3개를 생성한다.
// 실패 시 예외를 던지지 않고 null을 반환 — 호출부(createPhrase)가 폴백을 정한다.
import { z } from "zod";
import {
    UpstageChatMessage,
    callUpstageChat,
    generateWithRetry,
    parseJsonResponse,
} from "../../../shared/ai";

const phraseEvaluationSchema = z.object({
    memo: z.string().min(1).max(200),
    chips: z.array(z.string().min(1).max(20)).length(3),
});

export type PhraseEvaluationResult = z.infer<typeof phraseEvaluationSchema>;

interface EvaluatePhraseParams {
    phraseContent: string;
    missionTitle?: string | null;
}

export const evaluatePhrase = async (
    params: EvaluatePhraseParams
): Promise<PhraseEvaluationResult | null> => {
    const { phraseContent, missionTitle } = params;

    return generateWithRetry(async () => {
        const messages: UpstageChatMessage[] = [
            {
                role: "system",
                content:
                    "너는 대화 연습 앱에서 사용자가 저장한 문장을 평가하는 도우미다. " +
                    "사용자가 대화 중 인상 깊었던 문장을 저장하면, 그 문장이 어떤 맥락에서 " +
                    "왜 유용한지 한두 문장으로 평가하고, 활용도를 나타내는 짧은 태그 3개를 만든다. " +
                    "반드시 JSON으로만 답한다.",
            },
            {
                role: "user",
                content: [
                    missionTitle ? `미션: ${missionTitle}` : null,
                    `저장한 문장: "${phraseContent}"`,
                    "",
                    "다음 JSON 형식으로만 답해:",
                    `{"memo": "이 문장에 대한 평가/설명 (1~2문장)", "chips": ["태그1", "태그2", "태그3"]}`,
                ]
                    .filter(Boolean)
                    .join("\n"),
            },
        ];

        const res = await callUpstageChat(messages, { jsonMode: true, temperature: 0.4 });
        if (!res.ok) return null;

        return parseJsonResponse(res.content, phraseEvaluationSchema, "문장 평가");
    }, { label: "문장 평가" });
};