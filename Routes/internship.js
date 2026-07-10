const express = require("express");
const router = express.Router();
const Internship = require("../Model/Internship");

router.post("/", async (req, res) => {
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
  });
  await Internshipdata.save()
    .then((data) => {
      res.send(data);
    })
    .catch((error) => {
      console.log(error);
    });
});
const getMockInternships = () => [
  {
    _id: "mock-intern-1",
    title: "Demo Product Intern",
    company: "Internarea",
    location: "Remote",
    category: "Product Management",
    aboutCompany: "Demo company",
    aboutInternship: "Demo internship description",
    whoCanApply: "Students and freshers",
    perks: ["Mentorship", "Certificate"],
    numberOfOpening: 5,
    stipend: "₹15,000/month",
    startDate: "2026-01-15",
    additionalInfo: "This is mock data",
  },
];

router.get("/", async (req, res) => {
  try {
    const data = await Internship.find().lean();
    if (!data || data.length === 0) {
      return res.status(200).json(getMockInternships());
    }
    return res.status(200).json(data);
  } catch (error) {
    console.log("Internship GET / failed, returning mock:", error?.message || error);
    return res.status(200).json(getMockInternships());
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const data = await Internship.findById(id);
    if (!data) {
      res.status(404).json({ error: "internship not found" });
    }
    res.json(data).status(200);
  } catch (error) {
    console.log(error);
    res.status(404).json({ error: "internal server error" });
  }
});
module.exports = router;
