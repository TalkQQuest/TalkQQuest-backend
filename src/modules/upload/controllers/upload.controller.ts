import { Controller, Middlewares, Post, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from "express";
import multer from "multer";
import { authorizeUser } from "../../../middlewares/auth";
import { ValidationError } from "../../../shared/errors/common.error";
import { success, ApiResponse } from "../../../shared/utils/response";
import { uploadCommunityCoverImage, uploadProfileImage } from "../services/upload.service";

const upload = multer({ storage: multer.memoryStorage() });

const COVER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const coverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: COVER_IMAGE_MAX_BYTES },
});

// multer가 크기 초과 시 던지는 MulterError는 errorHandler가 AppError로 인식 못 해 500이 나므로,
// 여기서 잡아서 명세대로 400 VALIDATION_ERROR로 변환한다.
const handleCoverUpload = (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    coverUpload.single("file")(req, res, (err) => {
        if (err) return next(new ValidationError("이미지 형식/크기가 올바르지 않습니다."));
        next();
    });
};

export interface UploadProfileImageResponseDto {
    avatarUrl: string;
}

export interface UploadCommunityCoverResponseDto {
    imageUrl: string;
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

    /**
     * @summary 모임 커버 이미지 업로드
     */
    @Post("community-cover")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), handleCoverUpload)
    public async uploadCommunityCover(
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<UploadCommunityCoverResponseDto>> {
        const file = req.file;
        const imageUrl = await uploadCommunityCoverImage(file!);
        return success({ imageUrl });
    }
}
