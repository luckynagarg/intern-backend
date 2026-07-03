const express = require("express");
const router = express.Router();
const adminuser = "admin";
const adminpass = "admin";

// router.post("/adminlogin", (req, res) => {
//   const { username, password } = req.body;
//   if (username === adminuser && password === adminpass) {
//     res.send("admin is here");
//   } else {
//     res.send(401).send("unauthrized");
//   }
// });
module.exports = router;


router.post("/adminlogin", (req, res) => {
  const { username, password } = req.body;

  if (username ===adminuser&& password ===adminpass) {
    return res.status(200).json({
      success: true,
      message: "Admin login successful",
    });
  }

  return res.status(401).json({
    success: false,
    message: "Invalid credentials",
  });
});