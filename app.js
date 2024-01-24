const express = require("express");
const app = express();
const path = require('path');
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();
const ejs = require('ejs');
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const salt = 10;
const url = process.env.MONGODB_URL;
const client = new MongoClient(url);
const multer = require("multer");
const PORT = process.env.PORT;
const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const AWS = require("aws-sdk");
const fs = require("fs");
const bodyParser = require("body-parser");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));
//  const rekognition = new AWS.Rekognition();
const cors = require('cors');
app.use(cors());
const admin = require("firebase-admin");
const serviceAccount = require("./firebase.json");
const { datatosend } = require("./privacyPolicy");
app.use('/images', express.static(path.join(__dirname, 'images')));

const { OAuth2Client } = require('google-auth-library');
const googleclient = new OAuth2Client();
AWS.config.update({
  region: "us-east-1",
  accessKeyId: AWS_ACCESS_KEY,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
});

const BUCKET_NAME = "find-my-face-2";

const rekognition = new AWS.Rekognition();
const s3 = new AWS.S3({
  signatureVersion: 'v4',
});

app.use(express.json());

const upload = multer();

app.post("/api/faceScanner", upload.array("images"), async (req, res) => {
  try {
    let finalResult = [];
    console.log("req.files", req.files);
    console.log("faceScanner api is hit @");
    if (!req.files || !req.files.length) {
      return res.status(400).send("No files were uploaded.");
    }
    req.files.forEach(async (value) => {
      console.log("value", value)
      const imagePath = value.originalname;
      const fileContent = value.buffer;
      const objectKey = imagePath;
      // const fileContent = fs.readFileSync(imagePath);
      // const objectKey = imagePath;
      const params = {
        Bucket: "find-my-face-2",
        Key: objectKey,
        Body: fileContent,
        ContentType: value.mimetype,
      };
      // const result1 = await s3.putObject(params).promise()
      const uploadResult = await s3.upload(params).promise();

      console.log("uploadResult", uploadResult)

      const sourceImage = {
        S3Object: {
          Bucket: "find-my-face-2",
          Name: imagePath,
        },
      };

      const params1 = {
        Image: sourceImage,
      }

      try {
        const detectSourceface = await rekognition
          .detectFaces(params1)
          .promise();
        if (detectSourceface.FaceDetails.length > 0) {
          // console.log('Faces were detected in the image.');
        } else {
          // console.log('No faces were detected in the image.');
          res.json({ msg: "No faces were detected in the image." });
          return;
        }
      } catch (error) {
        console.error("Error:#####", error);
        res.json(error, "source image");
      }
      await client.connect();

      const db = client.db("mozziy_new");

      const collection = db.collection("Event");

      const result = await collection.find({}).toArray();

      const imagesWithFaces = [];
      const data = await Promise.all(
        result.map(async (value) => {
          if (value?.fileData) {
            let path = value.fileData.path
              ? value.fileData.path
              : value.fileData.Location;
            try {
              const targetImage = {
                S3Object: {
                  Bucket: "find-my-face-2",
                  Name: path,
                },
              };

              const params2 = {
                Image: targetImage,
              };
              const detectTargetImage = await rekognition
                .detectFaces(params2)
                .promise();
              if (detectTargetImage.FaceDetails.length > 0) {
                // console.log('Faces were detected in the image.');
                const compareObject = {
                  SourceImage: sourceImage,
                  TargetImage: targetImage,
                  SimilarityThreshold: 90, // Adjust the similarity threshold as needed
                };
                const { FaceMatches } = await rekognition
                  .compareFaces(compareObject)
                  .promise();

                if (FaceMatches && FaceMatches.length > 0) {
                  await Promise.all(
                    FaceMatches.map((match) => {
                      const similarity = match.Similarity;
                      console.log("similarity:", similarity);
                      finalResult.push(value);
                      console.log(finalResult, "finalResult000000");
                    })
                  );
                } else {
                  console.log("No matching faces found.");
                }
              } else {
                // console.log('No faces were detected in the image.');
              }

            } catch (err) {
              console.log(err);

            }
          }
        })
      );
      try {
        if (data) {
          console.log(finalResult, "finalResult313132132132");
          if (finalResult.length > 0) {
            res.json(finalResult);
          } else {
            res.json({ msg: "No matching faces found." });
          }
        }
      } catch (err) {
        console.log("error of daata", err);
      }
    });
  } catch (err) {
    console.log("errrrro=>>", err);
    console.log("err.__type", err.__type);
    console.log("err.__type", err.Code);
    fResult = { message: err, status: 400 };
    // res.send({ message: err, status: 400 })
  }
});

app.post(
  "/api/uploadProfilePicture",
  upload.array("images"),
  async (req, res) => {
    try {
      let finalResult = [];
      console.log("uploadProfilePicture api is hit @");
      if (!req.files || !req.files.length) {
        return res.status(400).send("No files were uploaded.");
      }

      const bucketName = "find-my-face-2";
      const uploadedData = [];
      console.log("req.body.userId", req.files);
      req.files.map(async (value) => {
        console.log("value", value);
        const imagePath = value.originalname;
        const fileContent = value.buffer;
        const objectKey = imagePath;
        const params = {
          Bucket: bucketName,
          Key: objectKey,
          Body: fileContent,
          ContentType: value.mimetype,
        };
        console.log("imagePath", imagePath);
        const uploadResult = await s3.upload(params).promise();
        console.log("@@@", uploadResult);
        uploadResult["path"] = uploadResult["Location"];
        uploadedData.push(uploadResult);
        const sourceImage = {
          S3Object: {
            Bucket: "find-my-face-2",
            Name: imagePath,
          },
        };

        const params1 = {
          Image: sourceImage,
        };

        try {
          const detectSourceface = await rekognition
            .detectFaces(params1)
            .promise();
          if (detectSourceface.FaceDetails.length > 0) {
            // console.log('Faces were detected in the image.');
          } else {
            // console.log('No faces were detected in the image.');
            res
              .status(400)
              .send({
                msg: "No faces were detected in the image. Please upload another Profile Picture",
                status: false,
                statusCode: 400,
              });
            return;
          }
        } catch (error) {
          console.error("Error:", error);
          res.json(error, "source image");
        }

        await client.connect();
        // Select a database
        const db = client.db("mozziy_new");
        // Select a collection
        const collection = db.collection("User");

        const result = await collection.findOneAndUpdate(
          { _id: new ObjectId(req.body.userId) },
          { $set: { profile_Image: uploadResult } },
          { upsert: true, returnDocument: "after" }
        );

        if (result) {
          res.send({
            msg: "Profile Updated successfully",
            status: true,
            imageData: result.profile_Image,
            statusCode: 200,
          });
        }
      });
    } catch (error) {
      console.log(error);
      res.status(400).send({ msg: error, status: false, statusCode: 400 });
    }
  }
);

// this is the key provided by charles
const stripe = require("stripe")(STRIPE_SECRET_KEY);

// this is the stripe payment code
app.post("/api/create-payment-intent", async (req, res) => {
  try {
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("Event");

    const result = await collection.findOne({ _id: new ObjectId(req.body.id) });

    if (result) {
      let amt = result.price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amt,
        currency: "usd",
        payment_method_types: ["card"],
        statement_descriptor: "Custom descriptor",
        description: "For Buying Photo",
      });
      // console.log(paymentIntent, "payment INtents")
      const clientSecret = paymentIntent.client_secret;
      // console.log(clientSecret, "clientSecret")
      res.send({ clientSecret });
    }
  } catch (err) {
    console.log("errr", err);
    res.send({ err });
  }
});

app.post("/api/upload", upload.array("images"), async (req, res) => {
  console.log("upload events is run");
  console.log("upload events is run");
  console.log("upload events is run");
  console.log("upload events is run");

  if (!req.files || !req.files.length) {
    return res.status(400).send("No files were uploaded.");
  }
  try {
    const bucketName = "find-my-face-2";
    const uploadedData = [];

    const result1 = Promise.all(
      req.files.map(async (value) => {
        // const imagePath = value.path;
        // const fileContent = fs.readFileSync(imagePath);
        const imagePath = value.originalname;
        const fileContent = value.buffer;
        const objectKey = imagePath;
        const params = {
          Bucket: bucketName,
          Key: objectKey,
          Body: fileContent,
          ContentType: value.mimetype,
        };

        const uploadResult = await s3.upload(params).promise();
        console.log("$$$$$$$", uploadResult);
        uploadedData.push(uploadResult);
        //   , (err, data) => {
        // if (err) {
        //   console.error('Error uploading image:', err);
        // } else {
        //   console.log('Image uploaded successfully:', data);
        // }
        // });
      })
    );
    let totalData = [];

    result1
      .then(() => {
        console.log("attat1111", uploadedData);
      })
      .then(() => {
        Promise.all(
          req.files.map(async (file, index) => {
            console.log("helloe=>", uploadedData);
            console.log("index", index);
            uploadedData[index]["path"] = uploadedData[index]["Location"];
            console.log("****=>", uploadedData[index]);
            let data = {
              userForeignKey: new ObjectId(req.body.userId),
              fileData: uploadedData[index],
              // country: req.body.country,
              category: req.body.category,
              photoTitle: req.body.photoTitle,
              photoDescription: req.body.photoDescription,
              price: Number(req.body.price),
              isFavorite: false,
              createdAt: new Date().toISOString(),
            };
            console.log("this is the data", data);
            totalData.push(data);
          })
        );
      })
      .then(async () => {
        if (!req.files) {
          console.log("we are heere111");
          return res
            .status(400)
            .json({ message: "No file provided", status: 400 });
        } else {
          await client.connect();
          // Select a database
          const db = client.db("mozziy_new");
          // Select a collection
          const collection = db.collection("Event");
          console.log("totalData", totalData);
          const result = await collection.insertMany(totalData);
          console.log("whether data is inserted in mongoDb", result);
          if (result.acknowledged)
            res.json({ message: "Uploaded successfully" });
        }
      });
  } catch (err) {
    console.log("This is the error=>", err);
    res.status(400).send({ msg: err.message, statusCode: 400 });
  }
});

app.get("/api/test", (req, res) => {
  // console.log("GET API IS HIT test")
  res.send("HAI GET API HIT test");
});

app.get("/test", (req, res) => {
  console.log("this is run");
  res.send({ msg: "This is run successfully" });
});

/****Register API */
app.post("/register", async (req, res) => {
  console.log("register api is hit");
  let msg;
  try {
    // Connect to the MongoDB server
    await client.connect();

    // Select a database
    const db = client.db("mozziy_new");

    // Select a collection
    const collection = db.collection("User");

    const user = await collection.findOne({ email: req.body.email });
    if (user) {
      return res.status(400).send({
        message: "Failed! Email is already in use!",
        statusCode: 400,
      });
    } else {
      let encryptedPassword = bcrypt.hashSync(req.body.password, salt);

      let data = {
        name: req.body.name,
        email: req.body.email,
        password: encryptedPassword,
        createdAt: new Date().toISOString(),
        signedByGoogle: false,
      };

      // Insert the data into the collection

      const result = await collection.insertOne(data);

      // Print the inserted document ID
      console.log("Inserted document ID:", result.insertedId);

      if (result.insertedId) {
        msg = "success";
      }
    }
  } catch (error) {
    console.error("Error:", error);
    if (error) {
      msg = {
        msg: error,
        status: 500,
        success: false,
      };
    }
  } finally {
    // Close the MongoDB client
    client.close();
  }

  console.log("RESISTER API IS HIT ");
  res.send({ msg });
});

app.post("/createStripeAccount", async (req, res) => {
  console.log("createStripeAccount is run");
  console.log(req.body);

  await client.connect();

  // Select a database
  const db = client.db("mozziy_new");

  // Select a collection
  const collection = db.collection("User");

  const result1 = await collection.findOne({ _id: new ObjectId(req.body.id) });
  try {
    const account = await stripe.accounts.create({
      country: "US",
      type: "express",
      email: result1.email,
      capabilities: {
        card_payments: {
          requested: true,
        },
        transfers: {
          requested: true,
        },
      },
    });
    console.log("account", account, "account");

    await client.connect();

    // Select a database
    const db = client.db("mozziy_new");

    // Select a collection
    const collection = db.collection("User");

    let result = await collection.findOneAndUpdate(
      { email: result1.email },
      { $set: { connectAccountId: account.id } }
    );
    console.log(result, "rsult");

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: "http://app://deepLink",
      return_url: "http://54.204.136.191:5000/redirecttoapp",
      type: "account_onboarding",
    });

    console.log("accountLink @@@@", accountLink, "accountLink @@@@");

    res.json({
      accountid: account.id,
      type: account.type,
      accountLink: accountLink,
      msg: result ? "created the connect account" : "error",
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err });
  }
});

app.get("/redirecttoapp", (req, res) => {
  res
    .writeHead(301, {
      Location: `app://deepLink`,
    })
    .end();
});

app.post("/loginWithGoogle", async (req, res) => {
  try {
    console.log("login with google api is hit");
    await client.connect();
    console.log("req.body", req.body);
    console.log("1111");

    const db = client.db("mozziy_new");
    console.log("2222");

    const collection = db.collection("User");

    let { email, name } = req.body;
    console.log("email", email);
    console.log("3333");
    const user = await collection.findOne({ email: email });
    console.log("user", user);
    console.log("4444");
    if (user) {
      if (user.signedByGoogle) {
        res.status(200).send({
          id: user._id,
          msg: "Authorized User! Redirect to login page",
          signedByGoogle: true,
          statusCode: 200,
          profile_Image: user?.profile_Image ? user?.profile_Image : null,
          userName: user.name,
          isNotifyUserEnabled: user?.isNotifyUserEnabled
            ? user?.isNotifyUserEnabled
            : null,
        });
      } else if (user.signedByGoogle === false) {
        res.status(409).send({
          msg: "Email already exists!. Please sign in by email and password",
          signedByGoogle: false,
          statusCode: 409,
        });
      }
    } else {
      data = {
        email,
        name,
        image: req?.body?.photo ? req?.body?.photo : null,
        emailVerified: null,
        createdAt: new Date().toISOString(),
        signedByGoogle: true,
      };
      const result = await collection.insertOne(data);
      if (result.insertedId) {
        res.status(200).send({
          message: "User Created Successfully",
          id: result.insertedId,
          signedByGoogle: true,
          status: 200,
        });
      }
    }
  } catch (error) {
    console.error("Errors>>>>:", error);
    res.status(500).send({
      message: error.msg,
      signedByGoogle: true,
      status: 500,
    });
  } finally {
    // Close the MongoDB client

    client.close();
  }
});

app.post("/api/login", async (req, resp) => {
  try {
    console.log("login api is run@@@@");
    console.log("req.body", req.body);
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("User");

    const result = await collection.findOne({
      email: { $regex: new RegExp(req.body.email, "i") },
    });

    if (result) {
      if (result.signedByGoogle) {
        resp.status(400).send({
          success: false,
          message: "Please Login with google Id",
          statusCode: 400,
        });
        console.log("asdlkasioduh22222");
      } else {
        bcrypt.compare(req.body.password, result.password, (err, res) => {
          if (err) {
            console.log(err);
          }
          if (res) {
            // Send JWT

            const payload = {
              userId: result._id,
              username: result.name,
            };

            const secretKey = process.env.JWT_SECRET_KEY;

            const token = jwt.sign(payload, secretKey);
            resp.status(200).send({
              id: result._id,
              token: token,
              msg: "Authentic User",
              signedByGoogle: false,
              statusCode: 200,
              profile_Image: result?.profile_Image
                ? result?.profile_Image
                : null,
              userName: result.name,
              isNotifyUserEnabled: result?.isNotifyUserEnabled
                ? result?.isNotifyUserEnabled
                : null,
            });
          } else {
            // response is OutgoingMessage object that server response http request

            resp.status(400).send({
              success: false,
              message: "Invalid Email or password",
              statusCode: 400,
            });
          }
        });
      }
    } else {
      resp.status(400).send({
        success: false,
        message: "Invalid Email or password",
        statusCode: 400,
      });
    }
  } catch (error) {
    console.error("Error:", error);
    if (error) {
      console.error(error);
      resp.status(500).send({
        msg: error,
        status: 500,
      });
    }
  }
});
// this is the api which will fetch the events in the dashboard page

app.post("/api/getAllEvents", async (req, res) => {
  try {
    console.log("req.body", req.body);
    console.log("this is running getAllEvents");
    await client.connect();
    const db = client.db("mozziy_new");
    const collection = db.collection("Event");
    const favouriteCollections = db.collection("Favorites");
    const favoriteEvents = await favouriteCollections
      .find({ user_id: new ObjectId(req.body.userId) })
      .toArray();
    const allEvents = await collection.find().toArray();
    // console.log("favoriteEvents", favoriteEvents)
    const favouriteEventsIds = favoriteEvents.map((fav) => fav.event_id);
    // console.log("favouriteEventsIds", favouriteEventsIds)
    // console.log(favoriteEvents)
    let result = {
      favouriteEventsIds: favouriteEventsIds,
      allEvents: allEvents,
      status: true,
    };
    if (favoriteEvents && allEvents) {
      res.send(result);
    }
  } catch (err) {
    console.log(err);
    res.status(400).send({ message: err, status: 400, statusCode: 400 });
  }
});

app.post("/api/loginWithApple", async (req, res) => {
  try {
    console.log("login with Apple api is hit");
    await client.connect();
    console.log("req.body", req.body);

    const db = client.db("mozziy_new");

    const collection = db.collection("User");

    let { email, name, id } = req.body;

    const user = await collection.findOne({ appleId: id });

    if (user) {
      if (user.signedByApple) {
        res.status(200).send({
          id: user._id,
          msg: "Authorized User! Redirect to login page",
          signedByApple: true,
          statusCode: 200,
          profile_Image: user?.profile_Image ? user?.profile_Image : null,
          userName: user.name,
          isNotifyUserEnabled: user?.isNotifyUserEnabled
            ? user?.isNotifyUserEnabled
            : null,
        });
      } else if (user.signedByApple === false) {
        res.status(409).send({
          msg: "Email already exists!. Please sign in by email and password",
          signedByApple: false,
          statusCode: 409,
        });
      }
    } else {
      data = {
        email,
        name,
        image: req?.body?.photo ? req?.body?.photo : null,
        emailVerified: null,
        createdAt: new Date().toISOString(),
        signedByApple: true,
        appleId: id,
      };
      const result = await collection.insertOne(data);
      if (result.insertedId) {
        res.status(200).send({
          message: "User Created Successfully",
          id: result.insertedId,
          signedByApple: true,
          status: 200,
        });
      }
    }
  } catch (error) {
    console.error("Errors>>>>:", error);
    res.status(500).send({
      message: error.msg,
      signedByGoogle: true,
      status: 500,
    });
  } finally {
    // Close the MongoDB client
    client.close();
  }
});

app.post("/api/getFeedEvents", async (req, res) => {
  let finalResult = [];
  try {
    console.log(
      "------------********getFeedEvents Api is run********-------------"
    );
    await client.connect();
    const db = client.db("mozziy_new");
    const userCollection = db.collection("User");
    const favouriteCollections = db.collection("Favorites");
    const favoriteEvents = await favouriteCollections
      .find({ user_id: new ObjectId(req.body.userId) })
      .toArray();
    const favouriteEventsIds = favoriteEvents.map((fav) => fav.event_id);
    const userResult = await userCollection.findOne({
      _id: new ObjectId(req.body.userId),
    });
    console.log("focus=>", userResult);
    // console.log("&&&",userResult.hasOwnProperty('profile_Image') )
    if (!userResult) {
      return res
        .status(400)
        .json({ message: "User not exist", statusCode: 400 });
    }
    if (!userResult.hasOwnProperty("profile_Image")) {
      return res
        .status(200)
        .json({
          message: "Please update your profile pic",
          statusCode: 200,
          allEvents: [],
        });
    }
    let imagePath = userResult.profile_Image.path
      ? userResult.profile_Image.path
      : userResult.profile_Image.Location;
    console.log("we are here");
    const sourceImage = {
      S3Object: {
        Bucket: "find-my-face-2",
        Name: imagePath,
      },
    };
    console.log("we are here22");
    const imagesWithFaces = [];

    const eventCollection = db.collection("Event");
    const eventResult = await eventCollection.find({}).toArray();
    console.log("we are here333");
    try {
      const data = await Promise.all(
        eventResult.map(async (value) => {
          console.log("we are here44444");
          if (value?.fileData) {
            let path = value.fileData.path
              ? value.fileData.path
              : value.fileData.Location;
            const targetImage = {
              S3Object: {
                Bucket: "find-my-face-2",
                Name: path,
              },
            };

            console.log("we are here555555");
            const params2 = {
              Image: targetImage,
            };
            console.log("we are here66666");

            console.log("we are here787777");
            console.log("this is the id", value._id);
            try {
              const detectTargetImage = await rekognition
                .detectFaces(params2)
                .promise();
              if (detectTargetImage.FaceDetails.length > 0) {
                // console.log('Faces were detected in the image.');
                const compareObject = {
                  SourceImage: sourceImage,
                  TargetImage: targetImage,
                  SimilarityThreshold: 90, // Adjust the similarity threshold as needed
                };
                const { FaceMatches } = await rekognition
                  .compareFaces(compareObject)
                  .promise();

                if (FaceMatches && FaceMatches.length > 0) {
                  await Promise.all(
                    FaceMatches.map((match) => {
                      const similarity = match.Similarity;
                      // console.log('similarity:', similarity)
                      finalResult.push(value);
                      // console.log(finalResult, "finalResult000000")
                    })
                  );
                } else {
                  // console.log('No matching faces found.');
                  console.log("we are here988888888");
                }
              } else {
                // console.log('No faces were detected in the image.');
              }
              console.log("we are here99999999");
            } catch (error) {
              console.log("error", error);
            }
          }
        })
      );
      // try {

      if (data) {
        console.log("*********************DASHBOARD PAGE DATA****************");
        console.log("tgis is the data", finalResult);
        if (finalResult.length > 0) {
          res.status(200).json({
            allEvents: finalResult,
            favouriteEventsIds: favouriteEventsIds,
            status: true,
            statusCode: 200,
          });
        } else {
          res.status(200).json({
            allEvents: finalResult,
            msg: "No matching faces found.",
            status: true,
            statusCode: 200,
          });
        }
      }
      // } catch (err) {

      //   console.log("error of daata", err)
      // }
    } catch (err) {
      // console.log("finalResult",finalResult)
      console.log("Error=>", err.Message);
    }
  } catch (err) {
    console.log("Error=>>>>", err);
    res.status(400).json({ Error: err, statusCode: 400 });
  }
});

app.delete("/api/deleteEvent", async (req, res) => {
  try {
    // console.log("req.body",req.body)
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("Event");
    console.log(req.body);
    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(req.body.id) },
      { $set: { isDeletedByOwner: true } },
      { upsert: true, returnDocument: "after" }
    );
    console.log(result, "result");
    // const findOneAndUpdate =
    // const bucketName = 'find-my-face-2';
    if (result) {
      res.json({ msg: "Deleted Successfully" });
    }
  } catch (err) {
    console.log(err);
    res.status(400).send({ message: err, status: 400 });
  }
});

app.post("/api/getEvents", async (req, res) => {
  try {
    // console.log("req.body",req.body)
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("Event");

    const result = await collection
      .find({ userForeignKey: new ObjectId(req.body.userId) })
      .toArray();
    let newResult = result.filter((res) => !res.isDeletedByOwner);
    if (newResult) {
      res.status(200).json(newResult);
    }
  } catch (err) {
    console.log(err);
    res.status(400).send({ message: err, status: 400 });
  }
});

app.post("/api/getAllFavoriteEvents", async (req, res) => {
  try {
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("Favorites");

    const favoriteAggregation = [
      {
        $match: {
          user_id: new ObjectId(req.body.userId),
        },
      },
      {
        $lookup: {
          from: "Event",
          localField: "event_id",
          foreignField: "_id",
          as: "additionalInfo2",
        },
      },
      {
        $unwind: "$additionalInfo2",
      },
    ];

    // const result = await collection.find({ user_id: new ObjectId(req.body.userId)}).toArray();
    const result = await collection.aggregate(favoriteAggregation).toArray();
    // console.log(result,"result")

    if (result) {
      res.json(result);
    }
  } catch (err) {
    console.log(err);
    res.status(400).send({ message: err, status: 400 });
  }
});

app.post("/addEventToFavorite", async (req, res) => {
  try {
    // console.log("add event to favorite api is run")
    // console.log("req.body",req.body)

    const { id, heart, loggedInUserId } = req.body;
    // console.log(id,"eventId")
    // console.log(typeof id,"typeof id")
    // console.log("value of heart is ",heart)
    // console.log(loggedInUserId,"userId")
    // console.log(typeof loggedInUserId,"typeof loggedInUserId")
    await client.connect();

    const db = client.db("mozziy_new");

    const collection = db.collection("Favorites");

    if (heart) {
      const result = await collection.insertOne({
        user_id: new ObjectId(loggedInUserId),
        event_id: new ObjectId(id),
        time: new Date().toISOString(),
      });

      // console.log(result,"result")
      if (result.insertedId) {
        res.status(200).send({ msg: "Event added to favorites", status: 200 });
      }
    } else {
      const result = await collection.deleteOne({
        user_id: new ObjectId(loggedInUserId),
        event_id: new ObjectId(id),
      });

      // console.log(result,"result")
      if (result.acknowledged) {
        res
          .status(200)
          .send({
            msg: "Event Removed from Favorites successfully",
            status: 200,
          });
      }
    }
    client.close();
  } catch (err) {
    console.log(err);
    res.status(400).send({ message: err, status: 400 });
  }
});

app.post("/savePurchase", async (req, res) => {
  try {
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");

    const collection2 = db.collection("User");
    const res = await collection2.findOne({
      _id: new ObjectId(req.body.owner),
    });

    if (res.connectAccountId != "") {
      const connectId = res.connectAccountId;
      console.log("connectId", connectId);
      console.log(
        "req.body.stripePayment.paymentIntent.id",
        req.body.stripePayment.paymentIntent.id
      );
      await checkPaymentIntent(
        connectId,
        req.body.stripePayment.paymentIntent.id
      );
      // Select a collection
      const collection = db.collection("purchases");

      let data = {
        stripePayment: req.body.stripePayment,
        owner: new ObjectId(req.body.owner),
        purchaser: new ObjectId(req.body.purchaser),
        event_id: new ObjectId(req.body.id),
      };

      let result = await collection.insertOne(data);

      if (result.acknowledged) {
        res.status(200).send({ msg: "Purchase saved successfully" });
      }
    } else {
      res
        .status(400)
        .send({ msg: "No connect account exists", statusCode: 400 });
    }
  } catch (err) {
    console.log("Errrrrrrr", err);
    res.status(400).send({ msg: err.message, statusCode: 400 });
  }
});

app.post("/saveNotification", async (req, res) => {
  try {
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");

    const collection = db.collection("User");

    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(req.body.userId) },
      { $set: { isNotifyUserEnabled: req.body.data } },
      { upsert: true, returnDocument: "after" }
    );
    console.log("this is the of save notification result", result);
    if (result) {
      res
        .status(200)
        .send({
          msg: "Updated successfully",
          status: true,
          statusCode: 200,
          data: { isNotifyUserEnabled: result.isNotifyUserEnabled },
        });
    }
  } catch (error) {
    console.log(error);
    res.status(400).send({ msg: error, status: false, statusCode: 400 });
  }
});

app.post("/getNotificationStatus", async (req, res) => {
  console.log("i am in getnotificStatus", req.body);
  try {
    await client.connect();
    const db = client.db("mozziy_new");
    const collection = db.collection("User");
    const result = await collection.findOne({
      _id: new ObjectId(req.body.userId),
    });
    console.log("result", result);
    if (result)
      res.send({
        msg: "data recieved successfully",
        status: true,
        data: { isNotifyUserEnabled: result.isNotifyUserEnabled },
      });
  } catch (error) {
    console.log(error);
    res.status(400).send({ msg: error, status: false, statusCode: 400 });
  }
});

app.post("/api/fetchProfileImage", async (req, res) => {
  console.log("i am in fetchProfileImage", req.body);
  try {
    await client.connect();
    const db = client.db("mozziy_new");
    const collection = db.collection("User");
    const result = await collection.findOne({
      _id: new ObjectId(req.body.userId),
    });
    console.log("result", result);
    if (result.profile_Image)
      res
        .status(200)
        .send({
          msg: "Profile Image recieved successfully",
          status: true,
          statusCode: 200,
          data: { profile_Image: result?.profile_Image },
        });
    else {
      res
        .status(400)
        .send({
          msg: "No Profile Image exists",
          status: false,
          statusCode: 400,
        });
    }
  } catch (error) {
    console.log(error);
    res.status(400).send({ msg: error, status: false, statusCode: 400 });
  }
});

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // databaseURL: 'https://mozziy-401505-default-rtdb.firebaseio.com/',
});

const sendNotification = async (token, name = "Mozziy User") => {
  let tokens = [token];
  await admin
    .messaging()
    .sendMulticast({
      tokens,
      data: {
        notifee: JSON.stringify({
          body: "Someone has uploaded a photo of you",
          // body:"Check",
          android: {
            channelId: `default`,
            actions: [
              {
                title: `Congratulations! ${name}`,
                pressAction: {
                  id: "read",
                },
              },
            ],
          },
        }),
      },
    })
    .then((response) => {
      console.log("Successfully sent message:", response);
      console.log("Successfully sent message:", response.responses[0].error);
      console.log(response.responses[0].error);
    })
    .catch((error) => {
      console.error("Error sending message:", error);
    });
};

let token1 =
  "ft8cAB4kSOGAPerPLOMKy0:APA91bHGTJt-h0YMluxkNTvrGci2EZJrpWlwndsitPio1t_74oGh2wgT32zAQZONSb9otoWHw1q4dvB3BjLZ5vTIRPsendp-WQGWJYzi0HktDlT1sfZLtCiZWhO8Qe16Dc717qvJCCqF";

app.get("/testSendNoti", (req, res) => {
  sendNotification(token1, "testerAPi");
  res.status(200).send({ msg: "done", statusCode: 200 });
});

app.post(
  "/compareUploadedEventFaceWithProfilePics",
  upload.array("images"),
  async (req, res) => {
    try {
      let finalResult = [];
      console.log("compareUploadedEventFaceWithProfilePics api is hit @");
      console.log(req.files, "@@");
      if (!req.files || !req.files.length) {
        return res.status(400).send("No files were uploaded.");
      }

      const bucketName = "find-my-face-2";
      console.log(req.files);
      req.files.map(async (value) => {
        const imagePath = value.originalname;
        const fileContent = value.buffer;
        const objectKey = imagePath;
        const params = {
          Bucket: bucketName,
          Key: objectKey,
          Body: fileContent,
          ContentType: value.mimetype,
        };
        const result1 = await s3.putObject(params).promise();

        console.log("location2222", result1);

        const sourceImage = {
          S3Object: {
            Bucket: "find-my-face-2",
            Name: imagePath,
          },
        };

        const params1 = {
          Image: sourceImage,
        };

        try {
          const detectSourceface = await rekognition
            .detectFaces(params1)
            .promise();
          if (detectSourceface.FaceDetails.length > 0) {
            // console.log('Faces were detected in the image.');
          } else {
            // console.log('No faces were detected in the image.');
            return res.json({ msg: "No faces were detected in the image." });
          }
        } catch (error) {
          console.error("Error:", error);
          res.status(400).json({ error: error + " source image" });
        }
        await client.connect();

        const db = client.db("mozziy_new");

        const collection = db.collection("User");

        const result = await collection
          .find({ profile_Image: { $exists: 1 } })
          .toArray();
        // console.log("result of current focus", result)

        const imagesWithFaces = [];
        try {
          const data = Promise.all(
            result.map(async (value) => {
              console.log("value.DEviceFcmtoken", value.DEVICEFCMTOKEN);
              console.log(
                "typeof value.DEviceFcmtoken",
                typeof value.DEVICEFCMTOKEN
              );
              try {
                const targetImage = {
                  S3Object: {
                    Bucket: "find-my-face-2",
                    Name: value.profile_Image.path,
                  },
                };
                try {
                  const params2 = {
                    Image: targetImage,
                  };
                  const detectTargetImage = await rekognition
                    .detectFaces(params2)
                    .promise();
                  if (detectTargetImage.FaceDetails.length > 0) {
                    // console.log('Faces were detected in the image.');
                    const compareObject = {
                      SourceImage: sourceImage,
                      TargetImage: targetImage,
                      SimilarityThreshold: 90, // Adjust the similarity threshold as needed
                    };

                    const { FaceMatches } = await rekognition
                      .compareFaces(compareObject)
                      .promise();
                    console.log("Length of facematches", FaceMatches.length);
                    if (FaceMatches && FaceMatches.length > 0) {
                      await Promise.all(
                        FaceMatches.map((match) => {
                          const similarity = match.Similarity;
                          console.log("similarity:", similarity);
                          console.log(
                            "######## value.DEVICEFCMTOKEN",
                            value.email
                          );
                          console.log(
                            "######## value.DEVICEFCMTOKEN",
                            value.DEVICEFCMTOKEN
                          );
                          // if similarity % is greater than 90 then we we send notification to that specific user images
                          if (typeof value.DEVICEFCMTOKEN === "string") {
                            console.log("this expected thing is run");
                            sendNotification(value.DEVICEFCMTOKEN, value.name);

                            finalResult.push(value);
                            console.log(finalResult, "finalResult000000");
                          }
                        })
                      );
                    } else {
                      console.log("No matching faces found.");
                    }
                  } else {
                    // console.log('No faces were detected in the image.');
                  }
                } catch (error) {
                  console.error("Error:", error);
                  // res.status(200).json({ msg: error, statusCode: 200 })
                  return;
                }
              } catch (err) {
                const error = [];
                console.log(err);
                error.push(err);
              }
            })
          );

          data.then(() => {
            console.log(finalResult, "finalResult313132132132");
            if (finalResult.length > 0) {
              console.log("this is run ())()()()()()((");
              res.status(200).json(finalResult);
              return;
            } else {
              res.json({ msg: "No matching faces found." });
            }
          });
        } catch (err) {
          console.log("error of daata", err);
        }
      });
    } catch (err) {
      console.log("errrrro=>>", err);
      console.log("err.__type", err.__type);
      console.log("err.__type", err.Code);
      fResult = { message: err, status: 400 };
      // res.send({ message: err, status: 400 })
    }
  }
);

app.get("/test1", (req, res) => {
  console.log("asdjasd");
  res.send("<a href='www.mozziyapp.com'><h1>hello</h1></a>");
});

app.get("/stripetest", async (req, res) => {
  const account = await stripe.accounts.create({
    type: "standard",
    email: "test@test.com",
    business_type: "individual",
    country: "US",
    default_currency: "usd",
  });
  console.log(account, "account");
});

app.post("/checkConnectAccountExists", async (req, res) => {
  console.log("hai this is running");
  try {
    console.log(req.body, "asdaskj");
    console.log("this i s run 1");
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("User");
    console.log("this i s run 2");
    // let data = JSON.parse(req.body.id)
    const result = await collection.findOne({ _id: new ObjectId(req.body.id) });
    console.log(result, "this is the resulr");
    console.log("this i s run 3");
    if (result.connectAccountId) {
      res
        .status(200)
        .send({
          msg: "Stripe account exists",
          Status: "Success",
          statusCode: 200,
        });
    } else {
      res
        .status(400)
        .send({
          msg: "Stripe account does not exist",
          Status: "Failed",
          statusCode: 400,
        });
    }
  } catch (err) {
    console.log("err=>", err);
    res.send({ msg: err });
  }
});

const checkPaymentIntent = async (connectId, paymentintentid) => {
  try {
    const paymentIntent = await stripe.charges.list({
      payment_intent: paymentintentid,
    });

    console.log("paymentIntent", paymentIntent.data[0].balance_transaction);

    const balanceTransaction = await stripe.balanceTransactions.retrieve(
      paymentIntent.data[0].balance_transaction
    );
    console.log("balanceTransaction", balanceTransaction);
    const amountToSendToSeller =
      balanceTransaction.net - (balanceTransaction.amount * 30) / 100;
    console.log("amountToSendToSeller", amountToSendToSeller);
    stripe.transfers
      .create({
        amount: amountToSendToSeller, // amount in cents
        currency: "usd",
        destination: connectId, // Replace with the actual Connect account ID
      })
      .then((transfer) => {
        console.log("Transfer successful:", transfer);
      })
      .catch((error) => {
        console.error("Error:", error);
      });
  } catch (err) {
    console.log("err", err);
  }
};

app.post("/api/getPurchases", async (req, res) => {
  try {
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("purchases");

    const result = await collection
      .find({ purchaser: new ObjectId(req.body.userId) })
      .toArray();

    const collection2 = db.collection("Event");

    const events = [];
    Promise.all(
      result.map(async (value) => {
        const res = await collection2.findOne({ _id: value.event_id });
        if (res) {
          events.push(res);
        }
      })
    ).then(() => {
      res.send({ events });
    });
  } catch (err) {
    console.log("ERROR", err);
    res.status(400).send({ message: err, status: 400 });
  }
});

app.post("/getLoggedInUserName", async (req, res) => {
  try {
    console.log("this is run");
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("User");
    console.log("id", req.body.id);
    const result = await collection.findOne({ _id: new ObjectId(req.body.id) });
    console.log("result", result);
    let data = result.name;
    let email = result.email;

    let connectedAccountId = result.connectAccountId;
    let balance = "";
    await stripe.balance.retrieve(
      { stripeAccount: connectedAccountId },
      function (err, balance) {
        if (err) {
          console.error("Error retrieving balance:", err);
        } else {
          // console.log('Balance:', balance);
          balance = balance.available[0].amount / 100;
          // Access available and pending balance as needed: balance.available and balance.pending
          res.send({ name: data, balance: balance, email: email });
        }
      }
    );
  } catch (err) {
    console.log("ERROR", err);
    res.status(400).send({ message: err, status: 400 });
  }
});

app.post("/api/setFcmToken", async (req, res) => {
  try {
    console.log("this is run setFcmToken");
    console.log("this is run setFcmToken");
    console.log("this is run setFcmToken");
    console.log("this is run setFcmToken");
    console.log("request body is of the setFCMTOKEN API ", req.body);
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("User");
    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(req.body.userId) },
      { $set: { DEVICEFCMTOKEN: req.body.FCMTOKEN } },
      { upsert: true, returnDocument: "after" }
    );
    console.log("result of the setFCMTOKEN API", result);
    if (result)
      res
        .status(200)
        .send({
          msg: "Fcm Token saved successfully",
          status: true,
          statusCode: 200,
        });
  } catch (error) {
    console.log(error);
    res.status(400).send({ msg: error, status: false, statusCode: 400 });
  }
});

app.post("/api/deleteFCMTOKEN", async (req, res) => {
  try {
    console.log("this is run deleteFCMTOKEN");
    console.log("this is run deleteFCMTOKEN");
    console.log("this is run deleteFCMTOKEN");
    console.log("this is run deleteFCMTOKEN");
    console.log("request body is ", req.body);
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("User");

    const check1 = await collection.findOne({
      _id: new ObjectId(req.body.userId),
    });
    console.log("^^^^^^^", check1, "&&&&&&&");
    // const result = await collection.findOneAndUpdate({ _id: new ObjectId(req.body.userId) },{ $set: { DEVICEFCMTOKEN : req.body.FCMTOKEN }},{ upsert:true, returnDocument: "after" })
    const result = await collection.updateOne(
      { _id: new ObjectId(req.body.userId) },
      { $unset: { DEVICEFCMTOKEN: "" } }
    );

    console.log(
      `${result.matchedCount} document(s) matched and ${result.modifiedCount} document(s) modified`
    );

    console.log("result", result);
    if (result.matchedCount > 0)
      res
        .status(200)
        .send({
          msg: "Fcm Token deleted successfully",
          status: true,
          statusCode: 200,
        });
    else {
      res
        .status(400)
        .send({ msg: "Some Error", status: false, statusCode: 400 });
    }
  } catch (error) {
    console.log(error);
    res.status(400).send({ msg: error, status: false, statusCode: 400 });
  }
});

app.post("/api/deleteAccount", async (req, res) => {
  try {
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("User");

    const check1 = await collection.deleteOne({
      _id: new ObjectId(req.body.userId),
    });

    console.log(check1);

    if (check1) res.send({ msg: "Account Deleted Successfully", Status: 400 });
  } catch (err) {
    console.log("Error==>", err);
    res.status(400).send({ msg: err, Status: 400, statusCode: 400 });
  }
});

app.get("/api/privacyPolicy", (req, res) => {
  console.log("privacy policy is run")
  res.send(datatosend);
});

// console.log(datatosend)

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');


app.get('/api/deleteAccountform', (req, res) => {
  // Render the HTML form using EJS
  try {
    console.log("this is running")
    res.render('index');
  } catch (err) { console.log("error of form", err) }
});


app.get('/api/AccountDeletedPage', (req, res) => {
  // Render the HTML form using EJS
  try {
    console.log("this is running")
    res.render('AccountDeleted.ejs');
  } catch (err) { console.log("error of form", err) }
});


app.get('/api/AccountNotDeletedPage', (req, res) => {
  // Render the HTML form using EJS
  try {
    console.log("this is running")
    res.render('AccountNotDeleted.ejs');
  } catch (err) { console.log("error of form", err) }
});


app.post('/submit', async (req, resp) => {
  console.log("submit is hit")
  const { email, password } = req.body;
  try {
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("User");
    const eventCollection = db.collection("Event")
    const result1 = await collection.findOne({
      email: email,
    });

    console.log("result1", result1)
    // return;
    if (!result1) {
      console.log("email not exist")
      resp.render('AccountNotDeleted.ejs')
    }
    else if (result1.signedByGoogle === true) {
      console.log("Signed by google")
      resp.render('GoogleSignInWeb.ejs')
    }
    else {
      console.log("Not Signed by google but normal sign in ")
      bcrypt.compare(password, result1.password, async (err, match) => {
        if (err) {
          console.log(err);
          // res.send(err);
        } else {
          if (match) {
            // Passwords match
            resp.render('AccountDeleteConfirmPage.ejs', { data: email });
          } else {
            // Passwords do not match
            resp.render('WrongCredentials.ejs');
          }
        }
      });
    }
  } catch (err) {
    console.log("Error==>", err);
    resp.status(400).send({ msg: err, Status: 400, statusCode: 400 });
  }
});

app.post("/api/deleteAccountLogic", async (req, res) => {
  const { email } = req.body
  try {
    console.log("deleteLogic is run")
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const userCollection = db.collection("User");
    const eventCollection = db.collection("Event");
    const userEmailResult = await userCollection.findOne({ email: email })
    const userQueryResult = await userCollection.deleteOne({ email: email })
    console.log("userQueryResult", userQueryResult)
    const filter = { userForeignKey: new ObjectId(userEmailResult._id) }
    const deletedEventsResult = await eventCollection.deleteMany(filter);
    console.log(deletedEventsResult)
    if (userQueryResult.acknowledged) {
        res.status(200).json({ msg: "User Deleted SuccessFully", statusCode: 200 })
    } else {
      res.status(400).json({ msg: "There is some error", statusCode: 400 })
    }
  }
  catch (err) {
    console.log(err)
    res.status(400).json({ msg: err, statusCode: 400 })
  }
  
})

app.get('/api/image', (req, res) => {
  // Replace 'example.jpg' with the actual filename
  res.sendFile(path.join(__dirname, 'images', 'mozziylogo.png'));
});

app.get('/api/googleSignIn', (req, res) => {
  console.log("google sign in web");
  res.render("GoogleSignInWeb.ejs")
})

app.post('/api/googlePayloadInfo', async(req, res) => {
try{
  console.log(req.body)
    let { credential, clientId } = req.body
    console.log("googlePayload is run")
    const ticket = await googleclient.verifyIdToken({
      idToken: credential,
      audience: clientId,  // Specify the CLIENT_ID of the app that accesses the backend
      // Or, if multiple clients access the backend:
      //[CLIENT_ID_1, CLIENT_ID_2, CLIENT_ID_3]
    });
    const payload = ticket.getPayload();
    const userid = payload['sub'];

    let email = payload.email;
    console.log("this is email recieved from payload",email);
   await client.connect();
   // Select a database
   const db = client.db("mozziy_new");
   // Select a collection
   const userCollection = db.collection("User");
   const eventCollection = db.collection("Event");
   const userEmailResult = await userCollection.findOne({ email: email })
   if(!userEmailResult){
    res.status(400).json({msg:"No user exists with this email", statusCode:400})
   }else if(userEmailResult.signedByGoogle === false )
     res.status(400).json({msg:"User has not signed in by google. Please login with your credentials", success:"NotSignedByGoogle"})
   const userQueryResult = await userCollection.deleteOne({ email: email })
   console.log("userQueryResult", userQueryResult)
   const filter = { userForeignKey: new ObjectId(userEmailResult._id) }
   const deletedEventsResult = await eventCollection.deleteMany(filter);
   console.log(deletedEventsResult)
   if (userQueryResult.acknowledged) {
       res.status(200).json({ msg: "User Deleted SuccessFully", statusCode: 200 })
   } else {
     res.status(400).json({ msg: "There is some error", statusCode: 400 })
   }
}catch(err){console.log(err)}
})

app.listen(PORT, () => {
  console.log("SERVER RUNNING ON PORT ", PORT);
});
