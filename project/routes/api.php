<?php

use App\Http\Controllers\CustomerController;
use App\Http\Controllers\CategoryController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\OrderController;
use Illuminate\Support\Facades\Route;

// Customers
Route::apiResource('customers', CustomerController::class);

// Categories
Route::apiResource('categories', CategoryController::class);

// Products
Route::apiResource('products', ProductController::class);
Route::get('products/reports/low-stock', [ProductController::class, 'lowStock']);
Route::post('products/{product}/adjust-stock', [ProductController::class, 'adjustStock']);

// Orders
Route::apiResource('orders', OrderController::class)->only(['index', 'store', 'show']);
Route::post('orders/{order}/items', [OrderController::class, 'addItem']);
Route::delete('orders/{order}/items/{item}', [OrderController::class, 'removeItem']);
Route::post('orders/{order}/confirm', [OrderController::class, 'confirm']);
Route::post('orders/{order}/cancel', [OrderController::class, 'cancel']);
Route::post('orders/{order}/ship', [OrderController::class, 'ship']);
Route::post('orders/{order}/deliver', [OrderController::class, 'deliver']);
Route::post('orders/{order}/discount', [OrderController::class, 'discount']);
Route::post('orders/{order}/pay', [OrderController::class, 'pay']);
