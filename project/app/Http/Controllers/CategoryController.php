<?php

namespace App\Http\Controllers;

use App\Models\Category;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CategoryController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Category::withCount('products')->orderBy('name')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
        ]);

        $data['slug'] = Str::slug($data['name']);
        $customer = Category::create($data);
        return response()->json($customer, 201);
    }

    public function show(Category $category): JsonResponse
    {
        return response()->json($category->load('products'));
    }

    public function update(Request $request, Category $category): JsonResponse
    {
        $data = $request->validate([
            'name' => 'sometimes|string|max:255',
            'description' => 'nullable|string',
            'active' => 'sometimes|boolean',
        ]);

        if (isset($data['name'])) {
            $data['slug'] = Str::slug($data['name']);
        }

        $category->update($data);
        return response()->json($category);
    }

    public function destroy(Category $category): JsonResponse
    {
        if ($category->products()->exists()) {
            return response()->json(['error' => 'Categoria possui produtos vinculados.'], 422);
        }
        $category->delete();
        return response()->json(null, 204);
    }
}
