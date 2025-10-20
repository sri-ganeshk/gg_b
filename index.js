import express, { json } from "express";
import multer from "multer";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import User from "./models/user.js";
import Course from "./models/course.js";
import connectDB from "./db.js";

dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
const PORT = 3000;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());

// Authentication middleware
const auth = (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ msg: "Token is not valid" });
  }
};

app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ msg: "User already exists" });
    }

    user = new User({
      email,
      password,
    });

    await user.save();

    const payload = {
      user: {
        id: user.id,
      },
    };

    jwt.sign(payload, process.env.JWT_SECRET, (err, token) => {
      if (err) throw err;
      res.json({ token });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const payload = {
      user: {
        id: user.id,
      },
    };

    jwt.sign(payload, process.env.JWT_SECRET, (err, token) => {
      if (err) throw err;
      res.json({ token });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

app.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("File uploaded:", {
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    const courseData = await analyzeFile(req.file.buffer, req.file.mimetype);

    // Save to MongoDB
    const course = new Course({
      title: courseData.courseTitle,
      json: JSON.stringify(courseData),
      user: req.user.id,
    });

    await course.save();

    // Send immediate response
    res.json({
      message: "File analyzed and saved successfully",
      courseId: course._id,
      course: courseData,
    });

    // Generate QnA and Flashcards in background
    (async () => {
      try {
        console.log(`Generating QnA and flashcards for course ${course._id}...`);
        
        const courseContentString = JSON.stringify(courseData);
        
        // Generate QnA
        const qnaResult = await qna(courseContentString);
        
        // Generate Flashcards
        const flashcardsResult = await generateFlashcards(courseContentString);

        course.qna = JSON.stringify(qnaResult);
        course.flashCard = JSON.stringify(flashcardsResult);
        await course.save();
        
        console.log(`Successfully updated course ${course._id} with QnA and flashcards`);
      } catch (error) {
        console.error(`Background processing error for course ${course._id}:`, error);
      }
    })();
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message || "Upload failed" });
  }
});

app.get("/courses", auth, async (req, res) => {
  try {
    const courses = await Course.find({ user: req.user.id }).select(
      "title _id"
    );
    res.json(courses);
  } catch (error) {
    console.error("Fetch courses error:", error);
    res.status(500).json({ error: "Failed to fetch courses" });
  }
});

app.get("/courses/:id", auth, async (req, res) => {
  try {
    const course = await Course.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json(course);
  } catch (error) {
    console.error("Fetch course error:", error);
    res.status(500).json({ error: "Failed to fetch course" });
  }
});

app.listen(PORT, () => {
});

const genAIClient = new GoogleGenerativeAI(process.env.API_TOKEN);

// Utility function to parse AI responses and extract JSON
function parseAIResponse(aiResponse) {
  try {
    // Remove markdown code blocks if present
    const jsonMatch =
      aiResponse.match(/```json\n([\s\S]*?)\n```/) ||
      aiResponse.match(/```\n([\s\S]*?)\n```/);
    const jsonString = jsonMatch ? jsonMatch[1] : aiResponse;
    return JSON.parse(jsonString);
  } catch (parseError) {
    console.error("Failed to parse AI JSON:", parseError);
    throw new Error("Failed to parse AI response");
  }
}

async function analyzeFile(fileBuffer, mimeType) {
  const model = genAIClient.getGenerativeModel({ model: "gemini-2.5-flash" });

  const chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [
          {
            text:
              "Generate a study material for the provided content which includes both user input and extracted PDF content. " +
              "Enhance the response with additional chapters or topics if required. " +
              "The study material should include: a course title, a summary of the course, and a list of chapters. " +
              "Each chapter must include a chapter title, a chapter summary, an emoji icon, and a list of topics in JSON format. " +
              "If the PDF content suggests more detailed topics or additional chapters, please include them.",
          },
        ],
      },
      {
        role: "model",
        parts: [
          {
            text:
              "```json\n" +
              "{\n" +
              '  "courseTitle": "Comprehensive Course on [Topic]",\n' +
              '  "courseSummary": "This course offers an enhanced and comprehensive study material by combining user input with detailed insights from extracted PDF content. It dynamically expands on topics and chapters as needed.",\n' +
              '  "chapters": [\n' +
              "    {\n" +
              '      "chapterTitle": "Introduction",\n' +
              '      "chapterSummary": "An overview of the course, integrating core concepts and PDF insights for a robust introduction.",\n' +
              '      "emoji": "📖",\n' +
              '      "topics": ["Course Overview", "Objectives", "PDF Key Highlights"]\n' +
              "    },\n" +
              "    {\n" +
              '      "chapterTitle": "Core Concepts",\n' +
              '      "chapterSummary": "This chapter delves into the essential concepts, with added details and extra topics based on the enhanced PDF content.",\n' +
              '      "emoji": "🧠",\n' +
              '      "topics": ["Fundamental Theories", "Detailed Explanations", "Additional Insights", "Supplementary Topics"]\n' +
              "    },\n" +
              "    {\n" +
              '      "chapterTitle": "Advanced Topics",\n' +
              '      "chapterSummary": "Advanced material that builds upon core ideas, enriched by the extracted PDF data. More chapters and topics may be added if necessary.",\n' +
              '      "emoji": "🚀",\n' +
              '      "topics": ["Advanced Techniques", "In-depth Analysis", "Extra Topics from PDFs"]\n' +
              "    }\n" +
              "  ]\n" +
              "}\n" +
              "```",
          },
        ],
      },
    ],
  });

  const result = await chat.sendMessage([
    {
      inlineData: {
        mimeType: mimeType,
        data: fileBuffer.toString("base64"),
      },
    },
  ]);

  const response = await result.response;
  const text = response.text();
  return parseAIResponse(text);
}

async function qna(courseContent) {
    const model = genAIClient.getGenerativeModel({ model: "gemini-2.5-flash" });
    const chat = model.startChat();

    const question = `Generate a comprehensive set of 15 questions and answers based on the following course content. 
    Please provide the response in the following JSON format:

    {
      "questions": [
        {
          "id": 1,
          "question": "What is the main topic of this course?",
          "answer": "The detailed answer explaining the concept thoroughly.",
          "difficulty": "easy|medium|hard",
          "chapter": "Chapter name or number",
          "type": "multiple-choice|short-answer|essay"
        }
      ]
    }

    Make sure to:
    - Cover all major topics from the course content
    - Include questions of varying difficulty levels (easy, medium, hard)
    - Provide detailed, accurate answers
    - Specify the question type and relevant chapter
    - Ensure questions test understanding, not just memorization`;

    const result = await chat.sendMessage(question + "\n\nCourse Content:\n" + courseContent);
    const response = await result.response;
    const text = response.text();
    return parseAIResponse(text);
}  

async function generateFlashcards(courseContent) {
    const model = genAIClient.getGenerativeModel({ model: "gemini-2.5-flash" });
    const chat = model.startChat();
    
    const prompt = `Create comprehensive flashcards based on the following course content. 
    Please provide the response in the following JSON format:

    {
      "flashcards": [
        {
          "id": 1,
          "front": "Question or key concept to remember",
          "back": "Clear, concise answer or explanation",
          "category": "Chapter or topic name",
          "difficulty": "easy|medium|hard",
          "tags": ["keyword1", "keyword2", "keyword3"]
        }
      ]
    }

    Guidelines for creating flashcards:
    - Focus on key concepts, definitions, and important facts
    - Keep the front side concise and clear
    - Provide comprehensive but not overwhelming back-side content
    - Create 20-25 flashcards covering all major topics
    - Include a mix of definition-based, concept-based, and application-based cards
    - Use relevant tags for easy categorization and searching
    - Ensure each flashcard tests a single concept for better learning`;

    const result = await chat.sendMessage(prompt + "\n\nCourse Content:\n" + courseContent);
    const response = await result.response;
    const text = response.text();
    return parseAIResponse(text);
}  
