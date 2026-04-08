<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Services\StockService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Product::with('category');

        if ($request->has('category_id')) {
            $query->where('category_id', $request->category_id);
        }
        if ($request->boolean('low_stock')) {
            $query->whereColumn('stock', '<=', 'min_stock');
        }

        return response()->json($query->orderBy('name')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'category_id' => 'required|exists:categories,id',
            'name' => 'required|string|max:255',
            'sku' => 'required|string|unique:products',
            'description' => 'nullable|string',
            'price' => 'required|numeric|min:0.01',
            'stock' => 'required|integer|min:0',
            'min_stock' => 'sometimes|integer|min:0',
        ]);

        $product = Product::create($data);
        return response()->json($product->load('category'), 201);
    }

    public function show(Product $product): JsonResponse
    {
        return response()->json($product->load('category'));
    }

    public function update(Request $request, Product $product): JsonResponse
    {
        $data = $request->validate([
            'category_id' => 'sometimes|exists:categories,id',
            'name' => 'sometimes|string|max:255',
            'sku' => "sometimes|string|unique:products,sku,{$product->id}",
            'description' => 'nullable|string',
            'price' => 'sometimes|numeric|min:0.01',
            'stock' => 'sometimes|integer|min:0',
            'min_stock' => 'sometimes|integer|min:0',
            'active' => 'sometimes|boolean',
        ]);

        $product->update($data);
        return response()->json($product->load('category'));
    }

    public function destroy(Product $product): JsonResponse
    {
        if ($product->orderItems()->exists()) {
            return response()->json(['error' => 'Produto possui pedidos vinculados.'], 422);
        }
        $product->delete();
        return response()->json(null, 204);
    }

    public function lowStock(StockService $stockService): JsonResponse
    {
        return response()->json($stockService->getLowStockProducts());
    }

    public function adjustStock(Request $request, Product $product, StockService $stockService): JsonResponse
    {
        $data = $request->validate([
            'quantity' => 'required|integer',
            'reason' => 'nullable|string',
        ]);

        $product = $stockService->adjustStock($product, $data['quantity'], $data['reason'] ?? '');
        return response()->json($product);
    }
}
