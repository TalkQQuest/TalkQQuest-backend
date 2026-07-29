import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { ValidationError } from "../../../shared/errors/common.error";

const s3 = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png"];
const BUCKET_NAME = process.env.S3_BUCKET_NAME!;

const uploadImage = async (file: Express.Multer.File, keyPrefix: string): Promise<string> => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new ValidationError("지원하지 않는 파일 형식입니다.");
    }

    const ext = file.mimetype === "image/jpeg" ? "jpg" : "png";
    const key = `${keyPrefix}/${uuidv4()}.${ext}`;

    await s3.send(
        new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        })
    );

    return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

export const uploadProfileImage = (file: Express.Multer.File): Promise<string> =>
    uploadImage(file, "profile-images");

// #114 — 모임 커버 이미지 업로드. 프로필 이미지와 같은 업로드 방식(mimetype 검증 + S3 업로드)을 공유하되,
// 이번에 5MB 크기 제한을 추가한다(컨트롤러의 multer `limits`에서 강제). 프로필 이미지는 기존 동작 유지를 위해 그대로 둔다.
export const uploadCommunityCoverImage = (file: Express.Multer.File): Promise<string> =>
    uploadImage(file, "community-covers");