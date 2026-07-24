import { Controller, Middlewares, Post, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import multer from "multer";
import { authorizeUser } from "../../../middlewares/auth";
import { success, ApiResponse } from "../../../shared/utils/response";
import { uploadProfileImage } from "../services/upload.service";

const upload = multer({ storage: multer.memoryStorage() });

export interface UploadProfileImageResponseDto {
    avatarUrl: string;
}

@Route("uploads")
@Tags("Upload")
export class UploadController extends Controller {
    /**
     * @summary 프로필 이미지 업로드
     */
    @Post("profile-image")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), upload.single("image"))
    public async uploadProfileImage(
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<UploadProfileImageResponseDto>> {
        const file = req.file;
        const avatarUrl = await uploadProfileImage(file!);
        return success({ avatarUrl }, "프로필 이미지가 업로드되었습니다.");
    }
}