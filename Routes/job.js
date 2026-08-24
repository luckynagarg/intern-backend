const express = require("express");
const router = express.Router();

const Job = require("../Model/Job");
const { verifyFirebaseIdToken } = require("../middleware/authFirebase");
const asyncHandler = require("../middleware/asyncHandler");

// POST /api/job — requires a valid Firebase token. The authenticated caller's
// uid is stored as the poster so ownership and accountability exist server-side.
router.post("/", verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  try {
    const jobdata = new Job({
      title: req.body.title,
      company: req.body.company,
      location: req.body.location,
      Experience: req.body.Experience,
      category: req.body.category,
      aboutCompany: req.body.aboutCompany,
      aboutJob: req.body.aboutJob,
      whoCanApply: req.body.whoCanApply,
      perks: req.body.perks,
      AdditionalInfo: req.body.AdditionalInfo,
      CTC: req.body.CTC,
      StartDate: req.body.StartDate,
      postedBy: req.user.uid,
    });
    const data = await jobdata.save();
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "internal server error" });
  }
}))

router.get("/", async (req, res) => {
  try {
    const data = await Job.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.log("Job GET / failed:", error?.message || error);
    return res.status(500).json({ error: "internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const data = await Job.findById(id);
    if (!data) {
      return res.status(404).json({ error: "Jobs not found" });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ error: "Invalid job id or internal server error" });
  }
});
module.exports=router