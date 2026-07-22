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

export const uploadProfileImage = async (file: Express.Multer.File): Promise<string> => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new ValidationError("지원하지 않는 파일 형식입니다.");
    }

    const ext = file.mimetype === "image/jpeg" ? "jpg" : "png";
    const key = `profile-images/${uuidv4()}.${ext}`;

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