const puppeteer = require("puppeteer");
const { PuppeteerScreenRecorder } = require("puppeteer-screen-recorder");
const nodemailer = require("nodemailer");
const schedule = require("node-schedule");
const express = require("express");
const fs = require("fs");
require("dotenv").config();

const BOT_EMAILID = process.env.BOT_EMAILID;
const BOT_MAIL_PASSWORD = process.env.BOT_MAIL_PASSWORD;
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH;
const RECEIVEING_EMAILID = process.env.RECEIVEING_EMAILID;
const NAUKRI_EMAILID = process.env.NAUKRI_EMAILID;
const NAUKRI_PASSWORD = process.env.NAUKRI_PASSWORD;
const NODE_ENV = process.env.NODE_ENV;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min, max) => delay(Math.floor(Math.random() * (max - min + 1) + min));

const sendEmail = async (subject, text, attachment) => {
  let transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: BOT_EMAILID,
      pass: BOT_MAIL_PASSWORD,
    },
  });

  let mailOptions = {
    from: `"Naukri Update Bot" <${BOT_EMAILID}>`,
    to: RECEIVEING_EMAILID,
    subject: subject,
    text: text,
  };

  if (attachment) {
    mailOptions.attachments = [
      {
        filename: "screenrecord.mp4",
        content: attachment,
      },
    ];
  }

  let info = await transporter.sendMail(mailOptions);

  console.log("Email sent: %s", info.messageId);
};

const naukriAutoUpdate = async (emailID, password) => {
  let browser;
  try {
    console.log("Naukri BOT is Running");
    const now = new Date();
    console.log(`Profile update started at: ${now.toLocaleString()}`);

    browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36",
      ],
      headless: true,
      slowMo: 100,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
    });

    const recorder = new PuppeteerScreenRecorder(page);
    const recordingPath = "/tmp/screenrecord.mp4";

    await recorder.start(recordingPath);

    await page.goto("https://www.naukri.com/nlogin/login", { waitUntil: "networkidle2" });
    await randomDelay(1000, 3000);
    console.log("Navigated to Naukri login page");

    if (!emailID || !password || typeof emailID !== "string" || typeof password !== "string") {
      throw new Error("Email ID or password is not set or not a string.");
    }

    await page.type("#usernameField", emailID);
    await randomDelay(1000, 2000);
    await page.type("#passwordField", password);
    await randomDelay(1000, 2000);
    console.log("Filled login form");

    // Click login button using data-ga-track attribute
    await page.click("button[data-ga-track='spa-event|login|login|Save||||true']");
    await randomDelay(2000, 4000); // Wait for a few seconds to allow the OTP page to load
    console.log("Submitted login form");

    // Check for OTP limit error message
    const otpErrorMessage = await page.evaluate(() => {
      const errorElement = document.querySelector('.err-container span.erLbl');
      return errorElement ? errorElement.innerText : null;
    });

    if (otpErrorMessage && otpErrorMessage.includes("you have reached max limit to generate otp today")) {
      console.error("Error: " + otpErrorMessage);
      const videoBuffer = fs.readFileSync(recordingPath);
      await sendEmail("Naukri Update Error", `Error: ${otpErrorMessage}`, videoBuffer);
      await recorder.stop();
      await browser.close();
      return;
    }

    try {
      await page.waitForSelector(".dashboard-container", { timeout: 90000 });
      console.log("Login successful");
    } catch (error) {
      console.error("Error waiting for .dashboard-container:", error);
      await recorder.stop();
      const videoBuffer = fs.readFileSync(recordingPath);
      await sendEmail("Naukri Update Error", `Error waiting for .dashboard-container: ${error}`, videoBuffer);
      throw error;
    }

    await page.goto("https://www.naukri.com/mnjuser/profile?id=&altresid", { waitUntil: "networkidle2" });
    await randomDelay(2000, 4000);
    console.log("Navigated to profile update section");

    await page.waitForSelector("#skillDetails", { timeout: 60000 });
    console.log("Profile page loaded");

    const manageKeySkills = async (action) => {
      try {
        await page.evaluate(() => {
          const keySkillsSection = [...document.querySelectorAll(".heading-container")].find((section) => section.innerText.includes("Key skills"));
          if (keySkillsSection) {
            keySkillsSection.querySelector(".new-pencil img").click();
          }
        });

        await page.waitForSelector(".sugCont", { timeout: 15000 });
        await randomDelay(1000, 2000);
        console.log(`Key skills dialog opened for ${action} action`);

        if (action === "remove") {
          await page.evaluate(() => {
            const figmaSkill = [...document.querySelectorAll(".chip")].find((chip) => chip.innerText.includes("Figma"));
            if (figmaSkill) {
              figmaSkill.querySelector(".fn-chips-cross").click();
            }
          });
          console.log("Removed 'Figma' skill");
        } else if (action === "add") {
          await page.type('input[placeholder="Enter your key skills"]', "Figma");
          await randomDelay(1000, 2000);

          const suggestionVisible = await page.waitForSelector(".sugCont", { visible: true, timeout: 30000 });

          if (suggestionVisible) {
            const figmaSuggestionHandle = await page.evaluateHandle(() => {
              const suggestions = [...document.querySelectorAll(".sugCont .Sbtn")];
              return suggestions.find((item) => item.innerText.includes("Figma"));
            });

            if (figmaSuggestionHandle) {
              await figmaSuggestionHandle.click();
              console.log("Added 'Figma' skill");
            } else {
              throw new Error("Figma suggestion not found in dropdown");
            }
          } else {
            throw new Error("Suggestion dropdown not visible");
          }

          await delay(2000);
        }

        await page.click("#submit-btn");
        await randomDelay(1000, 2000);
        console.log(`Saved key skills after ${action} action`);
      } catch (error) {
        console.error(`Error managing key skills (${action}):`, error);
        await sendEmail("Naukri Update Error", `Error managing key skills (${action}): ${error}`);
      }
    };

    await manageKeySkills("remove");
    await delay(5000);
    await manageKeySkills("add");

    await sendEmail(
      "Naukri Update Successful",
      `Your Naukri profile was successfully updated.\n\nCurrent Time: ${now.toLocaleString()}\nNext Scheduled Run: ${new Date(now.getTime() + 10 * 60000).toLocaleString()}`
    );
    console.log("Naukri profile successfully updated");
  } catch (error) {
    console.error("Error in Naukri auto update:", error);
    await sendEmail("Naukri Update Error", `Error in Naukri auto update: ${error}`);
  } finally {
    if (browser) {
      await recorder.stop();
      const videoBuffer = fs.readFileSync(recordingPath);
      await sendEmail("Naukri Update Finished", "Here is the screen recording of the session.", videoBuffer);
      await browser.close();
    }
  }
};

const emailID = NAUKRI_EMAILID;
const password = NAUKRI_PASSWORD;

const getRandomTime = () => {
  const now = new Date();
  const randomMinutes = Math.floor(Math.random() * 2) + 1; // Random minutes between 1 and 60
  const randomTime = new Date(now.getTime() + randomMinutes * 60000);
  return randomTime;
};

const scheduleJob = () => {
  try {
    const randomTime = getRandomTime();
    schedule.scheduleJob(randomTime, () => {
      const now = new Date();
      console.log(`Scheduled job running at: ${now.toLocaleString()}`);
      naukriAutoUpdate(emailID, password);
    });
    console.log(`Job scheduled to run daily at: ${randomTime.toLocaleTimeString()}`);
  } catch (error) {
    console.error("Error scheduling job:", error);
  }
};

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send({
    message: "Naukri Update Bot is running!",
    date: new Date().toLocaleString(),
    time: new Date().toLocaleTimeString(),
  });
});

scheduleJob();

app.get("/update", (req, res) => {
  res.send("<h1>Naukri Update Bot</h1>");
  naukriAutoUpdate(emailID, password);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
