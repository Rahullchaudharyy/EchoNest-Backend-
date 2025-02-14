import express from 'express'
import { validateAuth } from '../middleware/validateAuth.js'
import { Post } from '../models/Post.model.js';
import mongoose from 'mongoose';
import { User } from '../models/User.model.js';
import { Comment } from '../models/Comment.model.js';
import { upload } from '../middleware/Multer.js'
import { UploadOnCloudinary } from '../utils/Cloudinary.js'
import validator from 'validator'
import fs from 'fs'


const PostRoute = express.Router()

const SAFE_USER_DATA = '-_id username firstName lastName profileUrl bio posts';

PostRoute.post('/api/post/create', upload.single('file'), validateAuth, async (req, res) => {
    const session = await mongoose.startSession(); // Start a session for transaction
    session.startTransaction();

    try {
        const user = req.user
        console.log(req.file)
        const { title, content, status, category } = req.body;
        // console.log(title,content,status)
        const imageUrl = req.body.imageUrl;
        const imageFile = req.file;
        let cloudinaryResponse = null;
        if (imageUrl && validator.isURL(imageUrl)) {
            cloudinaryResponse = imageUrl;
        } else if (imageFile) {
            console.log(imageFile)
            const localFilePath = imageFile.path;
            cloudinaryResponse = await UploadOnCloudinary(localFilePath);
            fs.unlinkSync(localFilePath);
        }






        const CreatePost = new Post({
            title,
            content,
            imageUrl: cloudinaryResponse?.secure_url || cloudinaryResponse || null,
            status,
            postBy: {
                userId: user._id,
                name: user.firstName + user.lastName || null,
                profileUrl: user.profileUrl || null
            },
            category
        })



        await CreatePost.save({ session })

        await User.findByIdAndUpdate(
            user._id,

            { $push: { posts: CreatePost._id } },
            { new: true, session }
        )
        await session.commitTransaction()
        session.endSession()
        res.json({
            message: "PostCreated successfully !",

        })
    } catch (error) {
        await session.abortTransaction()
        session.endSession()
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.get('/api/post/myposts', validateAuth, async (req, res) => {
    try {
        const user = req.user;
        // console.log(user)
        const UserPosts = await Post.find({
            "postBy.userId": user._id
        })
        if (UserPosts.length == 0) {
            throw new Error("You have't created any post yet .")
        }
        res.status(200).json({
            message: 'Your All posts',
            data: UserPosts
        })
    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
// All posts feed api with pagination
PostRoute.get('/api/post/posts', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const user = req.user;
        let AllPosts = await Post.find({
            status: 'published'
        })
            .skip(skip)
            .limit(limit)
        if (AllPosts.filter((status) => status.status == 'private')) {
            AllPosts = AllPosts.filter((status) => status.status == 'published')
        }
        const totalPosts = await Post.countDocuments({ status: 'published' });

        res.status(200).json({
            message: 'All posts',
            totalNumberOfPosts: totalPosts,
            currentPage: page,
            totalPages: Math.ceil(totalPosts / limit),
            data: AllPosts
        })
    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.get('/api/post/view/:postId', async (req, res) => {
    try {
        const LoggedInUser = req.user;

        const postid = req.params.postId;
        const post = await Post.findOne({
            _id: postid
        })
        // console.log(post)

        if (!post) {
            return res.status(404).json({
                message: "Post not Found !! "
            })
        }

        if (post.status !== 'published') {

            console.log("Client Tried to access the private profile ")

            if (LoggedInUser._id !== post.postBy) {
                console.log("Client Tried to access the private profile again")
                return res.status(250).json({
                    message: 'You are tryin to find the private post that not suppose to find'
                })
            }
        }





        res.status(200).json({
            message: "Post found !! ",
            data: post
        })

    }
    catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
// edit the post 

PostRoute.patch('/api/post/edit/:postId', upload.single('file'), validateAuth, async (req, res) => {
    try {
        const user = req.user;
        const { title, content, status, category } = req.body;
        const postId = req.params.postId;

        console.log(req.body)

        if (!title || !content || !status) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        if (!status == 'private') {
            return res.status(400).json({ message: 'Invalid status value' });

        } else if (!status == 'published') {
            return res.status(400).json({ message: 'Invalid status value' });

        }

        if (!mongoose.Types.ObjectId.isValid(postId)) {
            return res.status(400).json({ message: 'Invalid postId format' });
        }

        const existingPost = await Post.findOne({
            "postBy.userId": user._id,
            _id: postId,
        });

        if (!existingPost) {
            return res.status(404).json({
                message: 'Post not found or you do not have permission to edit it'
            });
        }

        let imageUrl = existingPost.imageUrl;


        if (req.file) {
            try {
                const localFilePath = req.file.path;
                const cloudinaryResponse = await UploadOnCloudinary(localFilePath);
                fs.unlinkSync(localFilePath);
                imageUrl = cloudinaryResponse.secure_url;
            } catch (uploadError) {
                return res.status(500).json({ message: 'Image upload failed', error: uploadError.message });
            }
        }

        const updatedPost = await Post.findByIdAndUpdate(
            existingPost._id,
            {
                title,
                content,
                imageUrl,
                status,
                category,
            },
            { new: true }
        );

        res.status(200).json({
            message: 'Post updated successfully',
            data: updatedPost
        });
    } catch (error) {
        res.status(400).json({
            message: error.message
        });
    }
});
PostRoute.post('/api/post/like/:postId', validateAuth, async (req, res) => {
    try {
        const user = req.user;
        const PostId = req.params.postId;
        const post = await Post.findById(PostId);
        let message;

        if (!post) {
            return res.status(500).json({
                message: "Post not found for the like !!! "
            })
        }

        if (post.likedBy?.includes(user._id)) {
            console.log("This person ", user.firstName, "Already Liked this post ")
            let updateQuery;
            updateQuery = { $pull: { likedBy: user._id } };
            const Unlike = await Post.findByIdAndUpdate(post._id, updateQuery, { new: true })
            message = "Post Unliked successfully"
            if (!Unlike) {
                return res.status(400).json({
                    message: "Faild To unlike the post"
                })
            }
        } else {
            post.likedBy.push(user._id)
            message = "Post Liked successfully"
        }

        await post.save()
        res.status(201).json({
            message: message
        })
    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.get('/api/post/likedby/:postId', validateAuth, async (req, res) => {
    try {
        const postId = req.params.postId;
        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({
                message: "Post not found"
            })
        }
        const PostLikedBy = await User.find({
            _id: post.likedBy
        }).select(SAFE_USER_DATA)

        res.status(200).json({
            message: "Found ",
            data: PostLikedBy
        })
    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.post('/api/post/comment/:postId', validateAuth, async (req, res) => {

    try {
        const postId = req.params.postId;
        const user = req.user
        const { text } = req.body
        const post = await Post.findById(postId)

        if (!text || text.trim(' ').length == 0) {
            return res.status(400).json({
                message: "Comment text cannot be empty"
            })
        }

        const comment = new Comment({
            text,
            commentedBy: user._id,
            post: post
        })
        await comment.save()
        await Post.findByIdAndUpdate(postId, {
            $push: { comments: comment._id }
        })
        res.status(200).json({
            message: `You Commented On the post : ${post.title}...etc`,
            comment: comment
        })
    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.get('/api/post/:postid/comments', async (req, res) => {
    try {

        const id = req.params.postid
        const post = await Post.findById(id)
        const comments = await Comment.find({
            post: id
        }).populate('commentedBy')

        res.status(201).json({ message: "All comment on the pst of " + post.title, comments })

    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.post('/api/post/:postId/reply', validateAuth, async (req, res) => {
    try {
        const user = req.user;
        const postId = req.params.postId;
        const { ParentCommentId, text } = req.body
        if (ParentCommentId == user._id) {
            return res.status(500).json({
                message: "You can not reply yourself !! Invalid Request :) "
            })

        }
        if (!text || text.trim().length === 0 && !ParentCommentId || ParentCommentId.trim().length === 0) {
            return res.status(400).json({
                message: "fieds Are required !! text and ParentCommentId"
            })
        }
        const Parentcomment = await Comment.findById(ParentCommentId)
        if (!Parentcomment) {
            return res.status(400).json({
                message: "Comment Not found"
            })
        }

        const post = await Post.findById(postId)
        if (!post) {
            return res.status(400).json({
                message: "Something is wring with this comment "
            })
        }



        const replyInTheFormOfComment = new Comment({
            text,
            commentedBy: user._id,
            post: post._id,
            parentComment: ParentCommentId || null
        })

        await replyInTheFormOfComment.save()

        await Post.findByIdAndUpdate(postId, {
            $push: { comments: replyInTheFormOfComment._id }
        })

        Parentcomment.reply.push(replyInTheFormOfComment._id)
        await Parentcomment.save()

        res.status(201).json({
            message: "Comment added successfully",
            Parentcomment,
        });
    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.get('/api/post/comment/:commentId/replies', validateAuth, async (req, res) => {
    try {
        const user = req.user
        const commentId = req.params.commentId;
        const comment = await Comment.findById(commentId)
        const totalReplies = comment.reply.length;

        const replyOnThisComment = await Comment.find({
            _id: comment.reply,
        })

        res.json({ message: "Replies :-", totalReplies, replyOnThisComment })
    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.get('/api/posts/:userId', async (req, res) => {
    try {
        const id = req.params.userId
        const post = await Post.find({
            "postBy.userId": id,
            status: 'published'
        })

        if (!post || post.length < 1) {
            return res.status(200).json({
                message: "User Does not have any post"
            })
        }

        res.status(201).json({
            message: "Post Found",
            data: post
        })
    } catch (error) {
        return res.status(400).json({
            message: error.message
        })
    }

})
PostRoute.patch('/api/post/comment/edit/:commentId', validateAuth, async (req, res) => {
    try {
        const user = req.user;
        const commentId = req.params.commentId;
        const { text } = req.body;
        const comment = await Comment.findById(commentId)
        if (user._id.toString() !== comment.commentedBy.toString()) {
            return res.status(500).json({
                message: "You can not edit this comment !! Invalid Request ."
            })
        }
        if (!text) {
            return res.status(500).json({
                message: "Please enter the Text for edit"
            })

            // Please dont allOw user to hit the API untill or unless the field is not written . Message for the frontend guy . 
        }


        await Comment.findByIdAndUpdate(commentId, {
            text: text
        })

        res.status(201).json({
            message: "Updated successfully !!"
        })

    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.delete('/api/post/comment/delete/:commentId', validateAuth, async (req, res) => {
    try {

        const user = req.user;
        const commentId = req.params.commentId;
        const comment = await Comment.findById(commentId)
        if (!comment) {
            return res.status(500).json({ message: "Something is wrong with this comment!!" });

        }
        if (comment.commentedBy.toString() !== user._id.toString()) {
            return res.json({
                message: "You Can't delete someone else comment"
            })
        }

        await Comment.findByIdAndDelete(commentId)

        const post = await Post.findByIdAndUpdate(comment.post, {
            $pull: { comments: commentId }
        });

        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        res.status(201).json({
            message: "Comment Deleted !! "
        })
    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})
PostRoute.get('/api/authours/top', async (req, res) => {
    try {
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // Start of current month
        const startOfNextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1); // Start of next month

        // Aggregation query
        const topUsers = await Post.aggregate([
            // Step 1: Match posts created this month
            {
                $match: {
                    createdAt: {
                        $gte: startOfMonth,
                        $lt: startOfNextMonth,
                    },
                },
            },
            // Step 2: Group by postBy.userId and count the posts
            {
                $group: {
                    _id: "$postBy.userId", // Group by user ID
                    postCount: { $sum: 1 }, // Count the number of posts
                },
            },
            // Step 3: Sort by post count in descending order
            {
                $sort: { postCount: -1 },
            },
            // Step 4: Limit to the top 4 users
            {
                $limit: 4,
            },
        ]);

        // Step 5: Populate user details
        const populatedUsers = await User.populate(topUsers, {
            path: "_id",
            select: "username profileUrl firstName lastName emailId bio"
        });

        res.send(populatedUsers)
    } catch (error) {
        res.status(400).json({
            message: error.message
        })
    }
})



export { PostRoute }
