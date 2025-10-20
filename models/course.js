import mongoose from "mongoose";

const courseSchema = new mongoose.Schema({
  title: String,
  json: String,
  qna: String,
  flashCard: String,

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});

const Course = mongoose.model("Course", courseSchema);

export default Course;
