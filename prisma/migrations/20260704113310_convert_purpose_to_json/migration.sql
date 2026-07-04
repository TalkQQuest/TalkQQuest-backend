/*
  Warnings:

  - You are about to alter the column `purpose` on the `User_Profiles` table. The data in that column could be lost. The data in that column will be cast from `VarChar(255)` to `Json`.

*/
-- AlterTable
ALTER TABLE `User_Profiles` MODIFY `purpose` JSON NULL;
