// modules/community/realtime/chat.socket.ts
//
// #115 — 모임 실시간 채팅. REST 컨트롤러와 달리 tsoa/express 라우팅을 안 타고
// Socket.IO가 별도로 HTTP 서버에 붙어서 동작한다. server.ts에서 최초 1회 initChatSocket()을 호출한다.
import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import * as communityRepository from "../repositories/community.repository";
import * as chatRepository from "../repositories/chat.repository";

const NAMESPACE = "/communities";

interface AccessTokenPayload {
    sub: string;
}

interface ChatSocketData {
    userId: string;
}

let io: SocketIOServer | null = null;

const roomName = (communityId: string) => `community:${communityId}`;

// 클라이언트(Socket.IO 표준)는 handshake.auth.token으로 보내지만, Postman처럼
// auth 객체를 못 채우는 테스트 도구를 위해 쿼리 파라미터(?token=)도 함께 지원한다.
const authenticateSocket = (socket: Socket<any, any, any, ChatSocketData>, next: (err?: Error) => void) => {
    const raw = (socket.handshake.auth?.token ?? socket.handshake.query?.token) as string | undefined;
    const token = raw?.startsWith("Bearer ") ? raw.slice("Bearer ".length) : raw;

    if (!token) {
        return next(new Error("UNAUTHORIZED"));
    }

    try {
        const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
        socket.data.userId = payload.sub;
        next();
    } catch {
        next(new Error("UNAUTHORIZED"));
    }
};

export const initChatSocket = (httpServer: HttpServer): SocketIOServer => {
    io = new SocketIOServer(httpServer, {
        cors: { origin: "*" },
    });

    const communities = io.of(NAMESPACE);
    communities.use(authenticateSocket);

    communities.on("connection", (socket: Socket<any, any, any, ChatSocketData>) => {
        // 소켓 이벤트 핸들러는 express 미들웨어 체인 밖에 있어서 errorHandler가 안 잡아준다.
        // 여기서 던지는 예외를 못 잡으면 unhandledRejection으로 서버 프로세스 전체가 죽으므로
        // 핸들러마다 반드시 try/catch로 감싸고, 페이로드 형태도 방어적으로 검증한다.
        socket.on("join", async (payload: unknown) => {
            try {
                const communityId = (payload as { communityId?: unknown })?.communityId;
                if (typeof communityId !== "string" || !communityId) {
                    socket.emit("error", { code: "VALIDATION_ERROR", message: "communityId가 필요합니다." });
                    return;
                }

                const member = await communityRepository.findMember(communityId, socket.data.userId);
                if (!member) {
                    socket.emit("error", { code: "FORBIDDEN", message: "이 모임에 참여 중이 아닙니다." });
                    return;
                }
                socket.join(roomName(communityId));
            } catch (err) {
                logger.error({ err }, "채팅 join 이벤트 처리 실패");
                socket.emit("error", { code: "SERVER_ERROR", message: "서버 내부 오류가 발생했습니다." });
            }
        });

        socket.on("message:send", async (payload: unknown) => {
            try {
                const { communityId, content } = (payload as { communityId?: unknown; content?: unknown }) ?? {};
                if (typeof communityId !== "string" || !communityId) {
                    socket.emit("error", { code: "VALIDATION_ERROR", message: "communityId가 필요합니다." });
                    return;
                }
                if (typeof content !== "string" || !content.trim()) {
                    socket.emit("error", { code: "VALIDATION_ERROR", message: "메시지 내용을 입력해주세요." });
                    return;
                }

                const member = await communityRepository.findMember(communityId, socket.data.userId);
                if (!member) {
                    socket.emit("error", { code: "FORBIDDEN", message: "이 모임에 참여 중이 아닙니다." });
                    return;
                }

                const message = await chatRepository.createTextMessage(communityId, socket.data.userId, content);
                communities.to(roomName(communityId)).emit("message:new", {
                    id: message.id,
                    communityId,
                    userId: message.user_id,
                    userNickname: message.user?.name ?? null,
                    content: message.content,
                    type: message.type,
                    createdAt: message.created_at.toISOString(),
                });
            } catch (err) {
                logger.error({ err }, "채팅 message:send 이벤트 처리 실패");
                socket.emit("error", { code: "SERVER_ERROR", message: "서버 내부 오류가 발생했습니다." });
            }
        });

        socket.on("disconnect", () => {
            logger.debug({ userId: socket.data.userId }, "채팅 소켓 연결 종료");
        });
    });

    logger.info(`Chat WebSocket namespace ready: ${NAMESPACE}`);
    return io;
};

// community.service.ts의 승인 로직 등 REST 쪽에서 시스템 메시지를 쏘고 싶을 때 사용한다.
// 소켓 서버가 아직 초기화 전(예: 테스트 환경)이면 메시지 저장만 하고 브로드캐스트는 건너뛴다.
export const broadcastSystemMessage = async (communityId: string, content: string): Promise<void> => {
    const message = await chatRepository.createSystemMessage(communityId, content);

    if (!io) return;
    io.of(NAMESPACE)
        .to(roomName(communityId))
        .emit("message:new", {
            id: message.id,
            communityId,
            userId: null,
            userNickname: null,
            content: message.content,
            type: message.type,
            createdAt: message.created_at.toISOString(),
        });
};
