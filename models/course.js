import mongoose from "mongoose";

const courseSchema = new mongoose.Schema({
  title: {
    type: String,
  },
  json: {
    type: String,
  },
  qna: {
    type: String,
    default: "loading"
  },
  flashCard: {
    type: String,
    default: "loading"
  },

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});

const Course = mongoose.model("Course", courseSchema);

export default Course;
