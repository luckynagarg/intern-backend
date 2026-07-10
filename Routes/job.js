const express = require("express");
const router = express.Router();

const Job = require("../Model/Job");

router.post("/", async (req, res) => {
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
  });
  await jobdata.save().then((data)=>{
    res.send(data)
  }).catch((error)=>{
    console.log(error)
  })
});

const getMockJobs = () => [
  {
    _id: "mock-job-1",
    title: "Demo Frontend Developer",
    company: "Internarea",
    location: "Remote",
    Experience: "0-2 years",
    category: "Software Development",
    aboutCompany: "Demo company",
    aboutJob: "Demo job description",
    whoCanApply: "Students and freshers",
    perks: ["Mentorship", "Flexible hours"],
    AdditionalInfo: "This is mock data",
    CTC: "₹4 LPA",
    StartDate: "2026-01-01",
  },
];

router.get("/", async (req, res) => {
  try {
    const data = await Job.find().lean();
    if (!data || data.length === 0) {
      return res.status(200).json(getMockJobs());
    }
    return res.status(200).json(data);
  } catch (error) {
    console.log("Job GET / failed, returning mock:", error?.message || error);
    return res.status(200).json(getMockJobs());
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const data = await Job.findById(id);
    if (!data) {
      res.status(404).json({ error: "Jobs not found" });
    }
    res.json(data).status(200);
  } catch (error) {
    console.log(error);
    res.status(404).json({ error: "internal server error" });
  }
});
module.exports=router