const prisma = require("../../config/db");
const { AppError } = require("../../middleware/errorHandler");
const { getSupabaseClient } = require("../../config/supabase");

const AVATAR_BUCKET = "user-avatars";

function extensionFromMime(mime) {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    default: return "jpg";
  }
}

async function ensureBucket(supabase, bucketName) {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = (buckets || []).some((b) => b.name === bucketName);
  if (!exists) {
    await supabase.storage.createBucket(bucketName, { public: true, fileSizeLimit: 2097152 });
  }
}

async function getProfile(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, studentId: true, program: true, gender: true,
        avatarUrl: true, institutionId: true,
      },
    });
    if (!user) throw new AppError("User not found", 404);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { firstName, lastName, program, gender } = req.body;
    const data = {};
    if (firstName !== undefined) data.firstName = firstName;
    if (lastName !== undefined) data.lastName = lastName;
    if (program !== undefined) data.program = program;
    if (gender !== undefined) data.gender = gender;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, studentId: true, program: true, gender: true,
        avatarUrl: true, institutionId: true,
      },
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) throw new AppError("No file uploaded", 400);

    const ext = extensionFromMime(req.file.mimetype);
    const objectPath = `${req.user.id}/${Date.now()}.${ext}`;

    const supabase = getSupabaseClient();
    await ensureBucket(supabase, AVATAR_BUCKET);

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(objectPath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
        cacheControl: "3600",
      });

    if (uploadError) throw new AppError(`Avatar upload failed: ${uploadError.message}`, 500);

    const { data: publicUrlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath);
    const avatarUrl = publicUrlData?.publicUrl;
    if (!avatarUrl) throw new AppError("Avatar uploaded but URL could not be resolved", 500);

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, avatarUrl: true,
      },
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProfile, updateProfile, uploadAvatar };
