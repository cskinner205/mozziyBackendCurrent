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
    region: 'us-east-1',
    accessKeyId: AWS_ACCESS_KEY,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
});

const BUCKET_NAME = "find-my-face-2";

const rekognition = new AWS.Rekognition();
const s3 = new AWS.S3();

app.use(express.json());

const upload = multer();

app.post("/api/faceScanner", upload.array("images"), async (req, res) => {
    try {
        let finalResult = [];
        if (!req.files || !req.files.length) {
            return res.status(400).send("No files were uploaded.");
        }
        req.files.forEach(async (value) => {
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
                    res.json({ msg: "No faces were detected in the image." });
                    return;
                }
            } catch (error) {
                res.json(error, "source image");
            }

            const connection = await dbConnect()
            const result = await connection.db.collection("Event").find({}).toArray();

            const imagesWithFaces = [];
            const data = await Promise.all(
                result.map(async (value) => {
                    if (value?.fileData) {
                        let path = value.fileData.key
                        // ? value.fileData.path
                        // : value.fileData.Location;
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
                                            finalResult.push(value);
                                        })
                                    );
                                }
                            }

                        } catch (err) {
                            console.log(err);

                        }
                    }
                })
            );
            try {
                if (data) {
                    if (finalResult.length > 0) {
                        res.json(finalResult);
                    } else {
                        res.json({ msg: "No matching faces found." });
                    }
                }
            } catch (err) {
                console.log("error", err);
            }
            await connection.client.close()
        });
    } catch (err) {
        console.log("err", err);
        fResult = { message: err, status: 400 };
        // res.send({ message: err, status: 400 })
    }
});

app.post("/api/uploadProfilePicture", upload.array("images"), async (req, res) => {
    try {
        let finalResult = [];
        if (!req.files || !req.files.length) {
            return res.status(400).send("No files were uploaded.");
        }

        const bucketName = "find-my-face-2";
        const uploadedData = [];

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

            const uploadResult = await s3.upload(params).promise();
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
                if (!detectSourceface.FaceDetails.length) {
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
                console.error("error:", error);
                res.json(error, "source image");
            }

            const connection = await dbConnect()
            const result = await connection.db.collection("User").findOneAndUpdate(
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
        const connection = await dbConnect()
        const result = await connection.db.collection("Event").findOne({ _id: new ObjectId(req.body.id) });

        if (result) {
            let amt = result.price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amt,
                currency: "usd",
                payment_method_types: ["card"],
                statement_descriptor: "Custom descriptor",
                description: "For Buying Photo",
            });
            const clientSecret = paymentIntent.client_secret;
            res.send({ clientSecret });
        }
        await connection.client.close()
    } catch (err) {
        console.log("errr", err);
        res.send({ err });
    }
});

// app.post("/api/upload", upload.array("images"), async (req, res) => {
//     try {
//         const connection = await dbConnect();
//         let connectId = await connection.db.collection("User").findOne({ _id: new ObjectId(req.body.userId) });

//         if (!connectId) {
//             return res.status(404).send({ msg: "Connect Id not found", statusCode: 404 });
//         }

//         try {
//             const account = await stripe.accounts.retrieve(connectId.connectAccountId);
//             let enabled = account.charges_enabled ? 'Enabled' : 'Restricted';

//             if (enabled === 'Restricted' || !connectId.hasOwnProperty('connectAccountId')) {
//                 return res.status(404).send({
//                     msg: "Stripe account does not exist",
//                     accountStatus: 'Restricted',
//                     statusCode: 404,
//                 });
//             }

//             if (!req.files || !req.files.length) {
//                 return res.status(400).send("No files were uploaded.");
//             }

//             const bucketName = "find-my-face-2";
//             const uploadedData = [];

//             for (const value of req.files) {
//                 const imagePath = value.originalname;
//                 const fileContent = value.buffer;
//                 const objectKey = imagePath;
//                 const params = {
//                     Bucket: bucketName,
//                     Key: objectKey,
//                     Body: fileContent,
//                     ContentType: value.mimetype,
//                 };

//                 const uploadResult = await s3.upload(params).promise();
//                 uploadedData.push(uploadResult);
//             }

//             let totalData = [];

//             for (const [index, file] of req.files.entries()) {
//                 uploadedData[index]["path"] = uploadedData[index]["Location"];
//                 let data = {
//                     userForeignKey: new ObjectId(req.body.userId),
//                     fileData: uploadedData[index],
//                     category: req.body.category,
//                     photoTitle: req.body.photoTitle,
//                     photoDescription: req.body.photoDescription,
//                     isFavorite: false,
//                     isDeletedByOwner: false,
//                     createdAt: new Date().toISOString(),
//                 };
//                 totalData.push(data);
//             }

//             const result = await connection.db.collection("Event").insertMany(totalData);

//             if (result.acknowledged) {
//                 return res.json({ message: "Uploaded successfully" });
//             }

//         } catch (err) {
//             console.log("this is expected", err);
//             return res.status(400).send({ msg: err, statusCode: 400 });
//         }
//     } catch (error) {
//         console.log('error:', error);
//         return res.status(400).send({ msg: "ERROR 3", statusCode: 400 });
//     } finally {
//         await connection.client.close();
//     }
// });

app.post("/api/upload", upload.array("images"), async (req, res) => {
    console.log("upload events is run");
    console.log("upload events is run");
    console.log("upload events is run");
    console.log("upload events is run");
    await client.connect();
    // Select a database
    const db = client.db("mozziy_new");
    // Select a collection
    const collection = db.collection("User");

    // let connectId = await collection.findOne({ _id: new ObjectId(req.body.userId) })

    // let promise1 = new Promise((resolve, rej) => {
    //     if (connectId) {
    //         if (!connectId.hasOwnProperty('connectAccountId')) {

    //             console.log("this is run what i wanted")
    //             return res
    //                 .status(200)
    //                 .send({
    //                     msg: "Stripe account does not exist",
    //                     accountStatus: 'Restricted',
    //                     statusCode: 200,
    //                 });
    //             rej()
    //         } else {

    //             console.log("we are inside else")
    //             try {
    //                 stripe.accounts.retrieve(connectId.connectAccountId, (err, account) => {
    //                     if (err) {
    //                         console.error('Error retrieving account information:', err);
    //                     } else {
    //                         console.log("account chargse enabled", account.charges_enabled)
    //                         console.log('Account Status:', account.charges_enabled ? 'Enabled' : 'Restricted');
    //                         let enabled = account.charges_enabled ? 'Enabled' : 'Restricted'
    //                         if (enabled === 'Restricted') {
    //                             res
    //                                 .status(200)
    //                                 .send({
    //                                     msg: "Stripe account does not exist",
    //                                     accountStatus: 'Restricted',
    //                                     statusCode: 200,
    //                                 });

    //                             rej(false)
    //                         } else (resolve(true))
    //                     }
    //                 });
    //             } catch (err) { console.log("this is expected", err) }
    //         }
    //     } else {
    //         rej()
    //     }
    // })
    // console.log()
    // // if (promise1)
    //     promise1.then(() => {
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
                            isDeletedByOwner: false,
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
    // }).catch((err) => {
    //     es
    //         .status(400)
    //         .send({
    //             msg: err,
    //             statusCode: 400,
    //         })
    // })

});

app.get("/api/test", (req, res) => res.send("API is working"));
app.get("/test", (req, res) => res.send({ msg: "This is run successfully" }));

/* Register API */
app.post("/register", async (req, res) => {

    let msg;
    try {
        const connection = await dbConnect()
        const user = await connection.db.collection("User").findOne({ email: req.body.email });
        if (user) {
            return res.status(400).send({
                message: "Failed! Email is already in use!",
                statusCode: 400,
            });
        } else {
            let encryptedPassword = bcrypt.hashSync(req.body.password, salt);

            let data = {
                'name': req.body.name,
                'email': req.body.email,
                'password': encryptedPassword,
                'createdAt': new Date().toISOString(),
                'signedByGoogle': false,
            };

            // Insert the data into the collection
            const result = await collection.insertOne(data);

            if (result.insertedId) {
                msg = "success";
            }
        }
        await connection.client.close()
    } catch (error) {
        console.error("error:", error);
        if (error) {
            msg = {
                msg: error,
                status: 500,
                success: false,
            };
        }
    } finally {
        client.close();
    }
    res.send({ msg });
});

app.post("/createStripeAccount", async (req, res) => {
    const connection = await dbConnect()
    const result1 = await connection.db.collection("User").findOne({ _id: new ObjectId(req.body.id) });
    try {
        const account = await stripe.accounts.create({
            'country': "US",
            'type': "express",
            'email': result1.email,
            'capabilities': {
                'card_payments': {
                    'requested': true,
                },
                'transfers': {
                    'requested': true,
                },
            },
        });

        let result = await connection.db.collection("User")
            .findOneAndUpdate({ email: result1.email }, { $set: { connectAccountId: account.id } });

        const accountLink = await stripe.accountLinks.create({
            account: account.id,
            refresh_url: "http://app://deepLink",
            return_url: "http://54.204.136.191:5000/redirecttoapp",
            type: "account_onboarding",
        });

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
    await connection.client.close()
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
        let { email, name } = req.body;

        const connection = await dbConnect()
        const user = await connection.db.collection("User").findOne({ email: email });

        if (user) {
            if (user.signedByGoogle) {
                res.status(200).send({
                    'id': user._id,
                    'msg': "Authorized User! Redirect to login page",
                    'signedByGoogle': true,
                    'statusCode': 200,
                    'profile_Image': user?.profile_Image ? user?.profile_Image : null,
                    'userName': user.name,
                    'isNotifyUserEnabled': user?.isNotifyUserEnabled
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

        await connection.client.close()
    } catch (error) {
        console.error("Errors>>>>:", error);
        res.status(500).send({
            message: error.msg,
            signedByGoogle: true,
            status: 500,
        });
    } finally {
        client.close();
    }
});

app.post("/api/login", async (req, resp) => {
    try {
        const connection = await dbConnect()
        const result = await connection.db.collection("User").findOne({ email: { $regex: new RegExp(req.body.email, "i") } })

        if (result) {
            if (result.signedByGoogle) {
                resp.status(400).send({
                    success: false,
                    message: "Please Login with google Id",
                    statusCode: 400,
                });
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
        await connection.client.close()
    } catch (error) {
        console.error("Error:", error); 0
        resp.status(500).send({ msg: error, status: 500 });
    }
});
// this is the api which will fetch the events in the dashboard page
app.post("/api/getAllEvents", async (req, res) => {
    try {
        const connection = await dbConnect()
        const favoriteEvents = await connection.db.collection("Favorites").find({ user_id: new ObjectId(req.body.userId) }).toArray();
        const allEvents = await connection.db.collection("Event").find({ "isDeletedByOwner": false }).toArray();

        const favouriteEventsIds = favoriteEvents.map((fav) => fav.event_id);

        let result = {
            favouriteEventsIds: favouriteEventsIds,
            allEvents: allEvents,
            status: true,
        };
        if (favoriteEvents && allEvents) {
            res.send(result);
        }

        await connection.client.close()
    } catch (err) {
        console.log(err);
        res.status(400).send({ message: err, status: 400, statusCode: 400 });
    }
});

app.post("/api/loginWithApple", async (req, res) => {
    try {

        let { email, name, id } = req.body;

        const connection = await dbConnect()
        const user = await connection.db.collection("User").findOne({ appleId: id });

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
        await connection.client.close()
    } catch (error) {
        console.error("error:", error);
        res.status(500).send({
            message: error.msg,
            signedByGoogle: true,
            status: 500,
        });
    }
});

app.post("/api/getFeedEvents", async (req, res) => {
    let finalResult = [];
    try {
        const connection = await dbConnect()
        const favoriteEvents = await connection.db.collection("Favorites").find({ user_id: new ObjectId(req.body.userId) }).toArray()
        const userResult = await connection.db.collection("User").findOne({ _id: new ObjectId(req.body.userId) })

        const favouriteEventsIds = favoriteEvents.map((fav) => fav.event_id.toString());

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
        let imagePath = userResult.profile_Image.key

        const sourceImage = {
            S3Object: {
                Bucket: "find-my-face-2",
                Name: imagePath,
            },
        };

        const eventResult = await connection.db.collection("Event").find({ isDeletedByOwner: false }).toArray();
        try {
            const data = await Promise.all(
                eventResult.map(async (value) => {

                    if (value?.fileData) {
                        let path = value.fileData.key

                        const targetImage = {
                            S3Object: {
                                Bucket: "find-my-face-2",
                                Name: path,
                            },
                        };

                        const params2 = {
                            Image: targetImage,
                        };

                        try {
                            const detectTargetImage = await rekognition
                                .detectFaces(params2)
                                .promise();
                            if (detectTargetImage.FaceDetails.length > 0) {

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

                                            if (favouriteEventsIds.includes(value._id.toString())) {
                                                value.isFavorite = true
                                            }
                                            finalResult.push(value);
                                        })
                                    );
                                }
                            }
                        } catch (error) {
                            console.log("error", error);
                        }
                    }
                })
            );


            if (data) {
                if (finalResult.length > 0) {

                    // const promises = finalResult.map(finRes=>{
                    //   return new Promise((res,rej)=>{
                    //    if(favouriteEventsIds.includes(finRes._id.toString())){        
                    //     finRes.isFavorite = true
                    //     }else{  
                    //     }
                    //     res();
                    //   })
                    // })

                    // Promise.all(promises).then(()=>{
                    res.status(200).json({
                        allEvents: finalResult,
                        favouriteEventsIds: favouriteEventsIds,
                        status: true,
                        statusCode: 200,
                    });
                    // })
                } else {
                    res.status(200).json({
                        allEvents: finalResult,
                        msg: "No matching faces found.",
                        status: true,
                        statusCode: 200,
                    });
                }
            }

        } catch (err) {
            console.log("error", err);
        }

        await connection.client.close()
    } catch (err) {
        console.log("error", err);
        res.status(400).json({ Error: err, statusCode: 400 });
    }
});

app.delete("/api/deleteEvent", async (req, res) => {
    try {
        const connection = await dbConnect()
        const result = await connection.db.collection("Event").findOneAndUpdate(
            { _id: new ObjectId(req.body.id) },
            { $set: { isDeletedByOwner: true } },
            { returnDocument: 'after' }
        );

        if (result) {
            res.status(200).json({ msg: "Deleted Successfully", statusCode: 200 });
        } else {
            res.status(400).json({ msg: "No request data recieved", statusCode: 400 });
        }

        await connection.client.close()

    } catch (err) {
        console.log(err);
        res.status(400).send({ message: err, status: 400 });
    }
});

app.post("/api/getEvents", async (req, res) => {
    try {
        const connection = await dbConnect()
        const query = { 'userForeignKey': new ObjectId(req.body.userId), 'isDeletedByOwner': false }
        const result = await connection.db.collection("Event").find(query).toArray();


        if (result.length) {
            res.status(200).json(result);
        } else {
            res.status(404).json([])
        }

        await connection.client.close()
    } catch (err) {
        console.log(err);
        res.status(400).send({ message: err, status: 400 });
    }
});

app.post("/api/getAllFavoriteEvents", async (req, res) => {
    try {
        const connection = await dbConnect()
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
                    as: "favouriteEvents",
                },
            },
            {
                $unwind: "$favouriteEvents",
            }, {
                $project: {
                    _id: "$favouriteEvents._id",
                    userForeignKey: '$favouriteEvents.userForeignKey',
                    fileData: '$favouriteEvents.fileData',
                    category: '$favouriteEvents.category',
                    photoTitle: '$favouriteEvents.photoTitle',
                    photoDescription: '$favouriteEvents.photoDescription',
                    price: '$favouriteEvents.price',
                    isFavorite: '$favoriteEvents.isFavorite',
                    createdAt: '$favoriteEvents.createdAt'
                }
            }
        ];


        const result = await connection.db.collection("Favorites").aggregate(favoriteAggregation).toArray();

        if (result) res.json(result)

        await connection.client.close()
    } catch (err) {
        console.log(err);
        res.status(400).send({ message: err, status: 400 });
    }
});

app.post("/addEventToFavorite", async (req, res) => {
    try {
        const { id, heart, loggedInUserId } = req.body;
        const connection = await dbConnect()
        const collection = connection.db.collection("Favorites");

        if (heart === true) {
            const query = { 'user_id': new ObjectId(loggedInUserId), 'event_id': new ObjectId(id) }
            let duplicate = await collection.findOne(query)
            if (duplicate) {
                res.status(200).send({ msg: "Event already in favorites", status: 200 });
            } else {
                const insertData = {
                    user_id: new ObjectId(loggedInUserId),
                    event_id: new ObjectId(id),
                    time: new Date().toISOString(),
                }
                const result = await collection.insertOne(insertData);
                if (result.insertedId) {
                    res.status(200).send({ msg: "Event added to favorites", status: 200 });
                }
            }


        } else {
            const result = await collection.deleteOne({
                user_id: new ObjectId(loggedInUserId),
                event_id: new ObjectId(id),
            });

            if (result.acknowledged) {
                res
                    .status(200)
                    .send({
                        msg: "Event Removed from Favorites successfully",
                        status: 200,
                    });
            }
        }
        await connection.client.close();
    } catch (err) {
        console.log(err);
        res.status(400).send({ message: err, status: 400 });
    }
});

app.post("/savePurchase", async (req, resp) => {
    try {
        const { owner, id, purchaser, stripePayment } = req.body;

        const connection = await dbConnect()
        const collection2 = connection.db.collection("User")
        const res = await collection2.findOne({ _id: new ObjectId(owner) })

        if (res) {
            try {

                if (res.hasOwnProperty('connectAccountId')) {
                    const connectId = res.connectAccountId;

                    await checkPaymentIntent(
                        connectId,
                        stripePayment.paymentIntent.id
                    );

                    let data = {
                        stripePayment: stripePayment,
                        owner: new ObjectId(owner),
                        purchaser: new ObjectId(purchaser),
                        event_id: new ObjectId(id),
                    };

                    let result = await connection.db.collection('purchases').insertOne(data);

                    if (result.acknowledged) {
                        resp.status(200).json({ msg: "Purchase saved successfully" });
                    }
                } else {

                    resp.status(200).send({ msg: "No connect account exists for user who has uploaded this event", statusCode: 200 });
                }
            } catch (err) {
                console.log("error", err)
            }
        }
        await connection.client.close()
    } catch (err) {
        console.log("error", err);
        resp.status(400).json({ msg: err.message, statusCode: 400 });
    }
});

app.post("/saveNotification", async (req, res) => {
    try {
        const connection = await dbConnect()
        const result = await connection.db.collection("User").findOneAndUpdate(
            { _id: new ObjectId(req.body.userId) },
            { $set: { isNotifyUserEnabled: req.body.data } },
            { upsert: true, returnDocument: "after" }
        );
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
        await connection.client.close()
    } catch (error) {
        console.log(error);
        res.status(400).send({ msg: error, status: false, statusCode: 400 });
    }
});

app.post("/getNotificationStatus", async (req, res) => {
    try {
        const connection = await dbConnect()
        const result = await connection.db.collection("User").findOne({ _id: new ObjectId(req.body.userId) })

        if (result)
            res.send({
                msg: "data recieved successfully",
                status: true,
                data: { isNotifyUserEnabled: result.isNotifyUserEnabled },
            });
        await connection.client.close()
    } catch (error) {
        console.log(error);
        res.status(400).send({ msg: error, status: false, statusCode: 400 });
    }
});

app.post("/api/fetchProfileImage", async (req, res) => {

    try {
        const connection = await dbConnect()
        const result = await connection.db.collection("User").findOne({ _id: new ObjectId(req.body.userId) })

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

        await connection.client.close()
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
        .then((response) => console.log("error", response))
        .catch((error) => console.error("error", error));
};

let token1 =
    "ft8cAB4kSOGAPerPLOMKy0:APA91bHGTJt-h0YMluxkNTvrGci2EZJrpWlwndsitPio1t_74oGh2wgT32zAQZONSb9otoWHw1q4dvB3BjLZ5vTIRPsendp-WQGWJYzi0HktDlT1sfZLtCiZWhO8Qe16Dc717qvJCCqF";

app.get("/testSendNoti", (req, res) => {
    sendNotification(token1, "testerAPi");
    res.status(200).send({ msg: "done", statusCode: 200 });
});

app.post("/compareUploadedEventFaceWithProfilePics", upload.array("images"), async (req, res) => {
    try {
        const connection = await dbConnect()

        let finalResult = [];

        if (!req.files || !req.files.length) {
            return res.status(400).send("No files were uploaded.");
        }

        const bucketName = "find-my-face-2";
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
                const detectSourceface = await rekognition.detectFaces(params1).promise();
                if (!detectSourceface.FaceDetails.length) {
                    return res.json({ msg: "No faces were detected in the image." });
                }

            } catch (error) {
                console.error("error", error);
                res.status(400).json({ error: error + " source image" });
            }

            const result = await connection.db.collection("User").find({ profile_Image: { $exists: 1 } }).toArray();
            const imagesWithFaces = [];

            try {
                const data = Promise.all(
                    result.map(async (value) => {
                        try {
                            const targetImage = {
                                S3Object: {
                                    Bucket: "find-my-face-2",
                                    Name: value.profile_Image.key,
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

                                                // if similarity % is greater than 90 then we we send notification to that specific user images
                                                if (typeof value.DEVICEFCMTOKEN === "string") {
                                                    sendNotification(value.DEVICEFCMTOKEN, value.name);
                                                    finalResult.push(value);
                                                }
                                            })
                                        );
                                    } else {
                                        console.log("No matching faces found.");
                                    }
                                }
                            } catch (error) {
                                console.error("error:", error);
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
                    if (finalResult.length > 0) {
                        res.status(200).json(finalResult);
                        return;
                    } else {
                        res.json({ msg: "No matching faces found." });
                    }
                });
            } catch (err) {
                console.log("error", err);
            }
        })
        await connection.client.close()
    } catch (err) {
        fResult = { message: err, status: 400 };
    }
}
);

app.get("/test1", (req, res) => res.send("<a href='www.mozziyapp.com'><h1>hello</h1></a>"));

app.get("/stripetest", async (req, res) => {
    const account = await stripe.accounts.create({
        type: "standard",
        email: "test@test.com",
        business_type: "individual",
        country: "US",
        default_currency: "usd",
    });
});

app.post("/checkConnectAccountExists", async (req, res) => {
    try {
        const connection = await dbConnect()
        const result = await connection.db.collection("User").findOne({ _id: new ObjectId(req.body.id) });


        if (result.hasOwnProperty('connectAccountId')) {

            stripe.accounts.retrieve(result.connectAccountId, (err, account) => {
                if (err) {
                    console.error('error', err);
                    res.status(400)
                        .send({
                            msg: 'There is some error',
                            error: err,
                            Status: "Failed",
                            statusCode: 400,
                        });
                } else {
                    let enabled = account.charges_enabled ? 'Enabled' : 'Restricted'

                    let msg = ''
                    let statusCode = 200
                    if (enabled === 'Enabled') {
                        msg = 'Stripe account exists'
                    } else {
                        msg = "Stripe account does not exists";
                        statusCode = 400
                    }
                    res.status(statusCode)
                        .send({
                            'msg': msg,
                            'accountStatus': enabled,
                            'statusCode': statusCode,
                        });
                }
            });

        } else {
            res.status(400)
                .send({
                    msg: "Stripe account does not exist",
                    accountStatus: "Restricted",
                    statusCode: 400,
                });
        }
        await connection.client.close()
    } catch (err) {
        console.log("error", err);
        res.send({ msg: err });
    }
});

const checkPaymentIntent = async (connectId, paymentintentid) => {
    try {
        const paymentIntent = await stripe.charges.list({
            payment_intent: paymentintentid,
        });

        const balanceTransaction = await stripe.balanceTransactions.retrieve(
            paymentIntent.data[0].balance_transaction
        );

        const amountToSendToSeller = balanceTransaction.net - (balanceTransaction.amount * 30) / 100;

        stripe.transfers.create({
            amount: amountToSendToSeller, // amount in cents
            currency: "usd",
            destination: connectId, // Replace with the actual Connect account ID
        })
            .then((transfer) => console.log("Transfer successful:", transfer))
            .catch((error) => console.error("Error:", error));
    } catch (err) {
        console.log("err", err);
    }
};

app.post("/api/getPurchases", async (req, res) => {
    try {
        const connection = await dbConnect()
        const result = await connection.db.collection("purchases").find({ purchaser: new ObjectId(req.body.userId) }).toArray();

        const events = [];
        Promise.all(
            result.map(async (value) => {
                const res = await connection.db.collection.findOne({ _id: value.event_id });
                if (res) events.push(res)
            })
        ).then(() => res.send({ events }));

        await connection.client.close()
    } catch (err) {
        console.log("error", err);
        res.status(400).send({ message: err, status: 400 });
    }
});

app.post("/getStripeBalance", async (req, res) => {
    try {
        const connection = await dbConnect()
        const result = await connection.db.collection("User").findOne({ _id: new ObjectId(req.body.id) });

        let data = result.name;
        let email = result.email;

        let connectedAccountId = result.connectAccountId;

        let balance = "";
        await stripe.balance.retrieve(
            { stripeAccount: connectedAccountId },
            function (err, balance) {
                if (!err) {
                    balance = balance.available[0].amount / 100;  // Access available and pending balance as needed: balance.available and balance.pending
                    res.send({ name: data, balance: balance, email: email });
                }
            }
        )
        await connection.client.close()
    } catch (err) {
        console.log("error", err);
        res.status(400).send({ message: err, status: 400 });
    }
});

app.post("/api/setFcmToken", async (req, res) => {
    try {
        const connection = await dbConnect()
        const result = await connection.db.collection("User").findOneAndUpdate(
            { _id: new ObjectId(req.body.userId) },
            { $set: { DEVICEFCMTOKEN: req.body.FCMTOKEN } },
            { upsert: true, returnDocument: "after" }
        );
        if (result)
            res.status(200)
                .send({
                    msg: "Fcm Token saved successfully",
                    status: true,
                    statusCode: 200,
                })

        await connection.client.close()
    } catch (error) {
        console.log('error', error);
        res.status(400).send({ msg: error, status: false, statusCode: 400 });
    }
});

app.post("/api/deleteFCMTOKEN", async (req, res) => {
    try {
        const connection = await dbConnect()
        const check1 = await connection.db.collection("User").findOne({ _id: new ObjectId(req.body.userId) });
        const result = await connection.db.collection("User").updateOne({ _id: new ObjectId(req.body.userId) }, { $unset: { DEVICEFCMTOKEN: "" } });
        // const result = await collection.findOneAndUpdate({ _id: new ObjectId(req.body.userId) },{ $set: { DEVICEFCMTOKEN : req.body.FCMTOKEN }},{ upsert:true, returnDocument: "after" })

        if (result.matchedCount > 0)
            res.status(200)
                .send({
                    msg: "Fcm Token deleted successfully",
                    status: true,
                    statusCode: 200,
                });
        else {
            res.status(400)
                .send({ msg: "Some Error", status: false, statusCode: 400 });
        }

        await connection.client.close()
    } catch (error) {
        console.log('error', error);
        res.status(400).send({ msg: error, status: false, statusCode: 400 });
    }
});

app.post("/api/deleteAccount", async (req, res) => {
    try {
        const connection = await dbConnect()
        const check1 = await connection.db.collection("User").deleteOne({ _id: new ObjectId(req.body.userId) });
        if (check1) res.send({ msg: "Account Deleted Successfully", Status: 400 });

        await connection.client.close()
    } catch (err) {
        console.log("error", err);
        res.status(400).send({ msg: err, Status: 400, statusCode: 400 });
    }
});

app.get("/api/privacyPolicy", (req, res) => res.send(datatosend));
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');


app.get('/api/deleteAccountform', (req, res) => {
    // Render the HTML form using EJS
    try {
        res.render('index');
    } catch (err) { console.log("error of form", err) }
});


app.get('/api/AccountDeletedPage', (req, res) => {
    // Render the HTML form using EJS
    try {
        res.render('AccountDeleted.ejs');
    } catch (err) { console.log("error of form", err) }
});


app.get('/api/AccountNotDeletedPage', (req, res) => {
    // Render the HTML form using EJS
    try {
        res.render('AccountNotDeleted.ejs');
    } catch (err) { console.log("error of form", err) }
});


app.post('/submit', async (req, resp) => {
    const { email, password } = req.body;
    try {
        const connection = await dbConnect()
        const result1 = await connection.db.collection("User").findOne({ email })
        if (!result1) resp.render('AccountNotDeleted.ejs')
        else if (result1.signedByGoogle === true) resp.render('GoogleSignInWeb.ejs')
        else {
            bcrypt.compare(password, result1.password, async (err, match) => {
                if (err) console.log(err)
                else {
                    match
                        ? resp.render('AccountDeleteConfirmPage.ejs', { data: email })
                        : resp.render('WrongCredentials.ejs')
                }
            });
        }
        await connection.client.close()
    } catch (err) {
        console.log("error", err);
        resp.status(400).send({ msg: err, Status: 400, statusCode: 400 });
    }
});

app.post("/api/deleteAccountLogic", async (req, res) => {
    const { email } = req.body
    try {
        const connection = await dbConnect()
        const userQueryResult = await connection.db.collection("User").deleteOne({ email: email })

        // const filter = { userForeignKey: new ObjectId(userEmailResult._id) }
        // const deletedEventsResult = await eventCollection.deleteMany(filter);

        if (userQueryResult.acknowledged) {
            res.status(200).json({ msg: "User Deleted SuccessFully", statusCode: 200 })
        } else {
            res.status(400).json({ msg: "There is some error", statusCode: 400 })
        }
        await connection.client.close()
    }
    catch (err) {
        console.log(err)
        res.status(400).json({ msg: err, statusCode: 400 })
    }

})

app.get('/api/image', (req, res) => res.sendFile(path.join(__dirname, 'images', 'mozziylogo.png')))
app.get('/api/googleSignIn', (req, res) => res.render("GoogleSignInWeb.ejs"))
app.get('/api/normalSignIn', (req, res) => res.render("NormalSignIn.ejs"))

app.post('/api/googlePayloadInfo', async (req, res) => {
    try {
        const connection = await dbConnect()

        let { credential, clientId } = req.body
        const ticket = await googleclient.verifyIdToken({
            idToken: credential,
            audience: clientId,  // Specify the CLIENT_ID of the app that accesses the backend

            //[CLIENT_ID_1, CLIENT_ID_2, CLIENT_ID_3]
        });
        const payload = ticket.getPayload();
        const userid = payload['sub'];

        let email = payload.email;

        const userEmailResult = await connection.db.collection("User").findOne({ email: email })
        if (!userEmailResult) {
            res.status(404).json({ msg: "No user exists with this email", statusCode: 400 })
            return;
        } else if (userEmailResult.signedByGoogle === false) {
            res.status(400).json({ "message": "Invalid authentication method. Please use email and password.", "error": "InvalidRequest" })
            return;
        }
        const userQueryResult = await connection.db.collection("User").deleteOne({ email: email })

        if (userQueryResult.acknowledged) {
            res.status(200).json({ msg: "User Deleted SuccessFully", statusCode: 200 })
        } else {
            res.status(400).json({ msg: "There is some error", statusCode: 400 })
        }
    } catch (err) { console.log(err) }
})

app.listen(PORT, () => {
    console.log("SERVER RUNNING ON PORT ", PORT);
});


async function dbConnect() {
    const URL = process.env.MONGODB_URL;
    const DATA_BASE = 'mozziy_new'
    try {
        var client = await MongoClient.connect(URL, { useNewUrlParser: true, useUnifiedTopology: true })
        return { client: client, db: client.db(DATA_BASE) }
    } catch (error) {
        console.log('connection error', error)
        throw error
    }
}