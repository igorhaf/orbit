<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CustomerController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Customer::orderBy('name')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:customers',
            'phone' => 'nullable|string|max:20',
            'document' => 'required|string|unique:customers',
            'type' => 'required|in:individual,company',
            'address' => 'nullable|string',
        ]);

        $customer = Customer::create($data);
        return response()->json($customer, 201);
    }

    public function show(Customer $customer): JsonResponse
    {
        return response()->json($customer->load('orders'));
    }

    public function update(Request $request, Customer $customer): JsonResponse
    {
        $data = $request->validate([
            'name' => 'sometimes|string|max:255',
            'email' => "sometimes|email|unique:customers,email,{$customer->id}",
            'phone' => 'nullable|string|max:20',
            'document' => "sometimes|string|unique:customers,document,{$customer->id}",
            'type' => 'sometimes|in:individual,company',
            'address' => 'nullable|string',
            'active' => 'sometimes|boolean',
        ]);

        $customer->update($data);
        return response()->json($customer);
    }

    public function destroy(Customer $customer): JsonResponse
    {
        if ($customer->orders()->whereNotIn('status', ['delivered', 'cancelled'])->exists()) {
            return response()->json(['error' => 'Cliente possui pedidos em aberto.'], 422);
        }
        $customer->delete();
        return response()->json(null, 204);
    }
}
