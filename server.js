require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());

// Product Schema
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    sku: { type: String, default: () => "SKU-" + Date.now() },
    category: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, default: 5 },
    description: String,
    supplier: String
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

productSchema.virtual("stockValue").get(function () {
    return this.price * this.quantity;
});

const Product = mongoose.model("Product", productSchema);

// Validation Middleware
const validateProduct = (req, res, next) => {
    const { name, category, price, quantity } = req.body;

    if (req.method === "POST" && (!name || !category || price === undefined)) {
        return res.status(400).json({ message: "Name, category and price are required" });
    }

    if (price !== undefined && Number(price) < 0) {
        return res.status(400).json({ message: "Invalid price" });
    }

    if (quantity !== undefined && Number(quantity) < 0) {
        return res.status(400).json({ message: "Invalid quantity" });
    }

    next();
};

// Home Route
app.get("/", (req, res) => {
    res.send("Inventory Management API is Running");
});

// Create Product
app.post("/api/products", validateProduct, async (req, res, next) => {
    try {
        const product = await Product.create(req.body);
        res.status(201).json(product);
    } catch (error) {
        next(error);
    }
});

// Get All Products - Filtering, Sorting, Pagination
app.get("/api/products", async (req, res, next) => {
    try {
        const { category, search, sortBy = "createdAt", order = "desc" } = req.query;
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));

        const filter = {};

        if (category) filter.category = category;
        if (search) filter.name = { $regex: search, $options: "i" };

        const total = await Product.countDocuments(filter);

        const products = await Product.find(filter)
            .sort({ [sortBy]: order === "asc" ? 1 : -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({
            total,
            page,
            totalPages: Math.ceil(total / limit),
            count: products.length,
            products
        });
    } catch (error) {
        next(error);
    }
});

// Low Stock Alert
app.get("/api/products/low-stock", async (req, res, next) => {
    try {
        const products = await Product.find({
            $expr: { $lte: ["$quantity", "$reorderLevel"] }
        });
        res.json(products);
    } catch (error) {
        next(error);
    }
});

// Category-wise Inventory Summary
app.get("/api/products/summary/categories", async (req, res, next) => {
    try {
        const summary = await Product.aggregate([
            {
                $group: {
                    _id: "$category",
                    totalProducts: { $sum: 1 },
                    totalQuantity: { $sum: "$quantity" },
                    totalInventoryValue: {
                        $sum: { $multiply: ["$price", "$quantity"] }
                    }
                }
            }
        ]);

        res.json(summary);
    } catch (error) {
        next(error);
    }
});

// Get Single Product
app.get("/api/products/:id", async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: "Invalid product ID" });
        }

        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }

        res.json(product);
    } catch (error) {
        next(error);
    }
});

// Update Product and Stock Adjustment
app.put("/api/products/:id", validateProduct, async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: "Invalid product ID" });
        }

        const { stockAdjustment, ...updates } = req.body;
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }

        Object.assign(product, updates);

        if (stockAdjustment !== undefined) {
            const newQuantity = product.quantity + Number(stockAdjustment);

            if (newQuantity < 0) {
                return res.status(400).json({ message: "Insufficient stock" });
            }

            product.quantity = newQuantity;
        }

        await product.save();
        res.json(product);
    } catch (error) {
        next(error);
    }
});

// Delete Product
app.delete("/api/products/:id", async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: "Invalid product ID" });
        }

        const product = await Product.findByIdAndDelete(req.params.id);

        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }

        res.json({ message: "Product deleted successfully" });
    } catch (error) {
        next(error);
    }
});

// Not Found Handler
app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
});

// Centralized Error Handling
app.use((error, req, res, next) => {
    console.error(error.message);
    res.status(error.status || 500).json({
        message: error.message || "Internal Server Error"
    });
});

// Start Server
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB Connected Successfully");

        app.listen(process.env.PORT || 5000, () => {
            console.log("Server running on port 5000");
        });
    })
    .catch(error => {
        console.log("MongoDB Error:", error.message);
    });