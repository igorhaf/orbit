<?php

namespace App\Http\Controllers;

use App\Models\Order;
use App\Services\OrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function __construct(private OrderService $orderService) {}

    public function index(Request $request): JsonResponse
    {
        $query = Order::with(['customer', 'items.product']);

        if ($request->has('status')) {
            $query->where('status', $request->status);
        }
        if ($request->has('customer_id')) {
            $query->where('customer_id', $request->customer_id);
        }

        return response()->json($query->orderByDesc('created_at')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'customer_id' => 'required|exists:customers,id',
            'notes' => 'nullable|string',
        ]);

        $order = $this->orderService->createOrder($data['customer_id'], $data['notes'] ?? null);
        return response()->json($order->load('customer'), 201);
    }

    public function show(Order $order): JsonResponse
    {
        return response()->json($order->load(['customer', 'items.product', 'payment']));
    }

    public function addItem(Request $request, Order $order): JsonResponse
    {
        $data = $request->validate([
            'product_id' => 'required|exists:products,id',
            'quantity' => 'required|integer|min:1',
        ]);

        $item = $this->orderService->addItem($order, $data['product_id'], $data['quantity']);
        return response()->json($item->load('product'), 201);
    }

    public function removeItem(Order $order, int $itemId): JsonResponse
    {
        $this->orderService->removeItem($order, $itemId);
        return response()->json(null, 204);
    }

    public function confirm(Order $order): JsonResponse
    {
        $order = $this->orderService->confirmOrder($order);
        return response()->json($order->load(['customer', 'items.product']));
    }

    public function cancel(Order $order): JsonResponse
    {
        $order = $this->orderService->cancelOrder($order);
        return response()->json($order);
    }

    public function ship(Order $order): JsonResponse
    {
        $order->markShipped();
        return response()->json($order->fresh());
    }

    public function deliver(Order $order): JsonResponse
    {
        $order->markDelivered();
        return response()->json($order->fresh());
    }

    public function discount(Request $request, Order $order): JsonResponse
    {
        $data = $request->validate([
            'discount' => 'required|numeric|min:0',
        ]);

        $order = $this->orderService->applyDiscount($order, $data['discount']);
        return response()->json($order);
    }

    public function pay(Request $request, Order $order): JsonResponse
    {
        $data = $request->validate([
            'method' => 'required|in:credit_card,debit_card,pix,boleto,cash',
        ]);

        $payment = $this->orderService->processPayment($order, $data['method']);
        return response()->json($payment, 201);
    }
}
