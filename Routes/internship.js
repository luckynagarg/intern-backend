const express = require("express");
const router = express.Router();
const Internship = require("../Model/Internship");
const { verifyFirebaseIdToken } = require("../middleware/authFirebase");
const asyncHandler = require("../middleware/asyncHandler");

router.post("/", verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  try {
    const Internshipdata = new Internship({
      title: req.body.title,
      company: req.body.company,
      location: req.body.location,
      category: req.body.category,
      aboutCompany: req.body.aboutCompany,
      aboutInternship: req.body.aboutInternship,
      whoCanApply: req.body.whoCanApply,
      perks: req.body.perks,
      numberOfOpening: req.body.numberOfOpening,
      stipend: req.body.stipend,
      startDate: req.body.startDate,
      additionalInfo: req.body.additionalInfo,
      postedBy: req.user.uid,
    });
    const data = await Internshipdata.save();
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "internal server error" });
  }
}));
router.get("/", async (req, res) => {
  try {
    const data = await Internship.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.log("Internship GET / failed:", error?.message || error);
    return res.status(500).json({ error: "internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const data = await Internship.findById(id);
    if (!data) {
      return res.status(404).json({ error: "internship not found" });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ error: "Invalid internship id or internal server error" });
  }
});
module.exports = router;
