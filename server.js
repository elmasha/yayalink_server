const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  console.log("Incoming:", req.method, req.url);
  next();
});

app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/notifications", require("./routes/notification.routes"));
app.use("/api/users", require("./routes/users.routes"));
 app.use("/api/bureaus", require("./routes/bureau.routes"));
 app.use("/api/candidates", require("./routes/candidates.routes"));
 app.use("/api/employers", require("./routes/employers.routes"));
 app.use("/api/payments", require("./payments/mpesa_stkpush"));
 app.use("/api/counties", require("./routes/counties.routes"));
app.use("/api/employer-access", require("./routes/employerAccess.routes"));

// app.use("/api/payments", require("./routes/payments.routes"));
// app.use("/api/feedback", require("./routes/feedback.routes"));

// Base route
app.get("/", (req, res) => res.send("YayaLink Backend API Running 🚀"));

const PORT = process.env.PORT ;
app.listen(PORT, () => console.log(`✅ YayaLink Server running on port  http://localhost:${PORT}`));
