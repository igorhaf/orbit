<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Payment;
use Illuminate\Support\Facades\DB;

class OrderService
{
    public function createOrder(int $customerId, ?string $notes = null): Order
    {
        return Order::create([
            'customer_id' => $customerId,
            'number' => Order::generateNumber(),
            'status' => 'draft',
            'notes' => $notes,
        ]);
    }

    public function addItem(Order $order, int $productId, int $quantity): OrderItem
    {
        if ($order->status !== 'draft') {
            throw new \DomainException('Itens so podem ser adicionados a pedidos em rascunho.');
        }

        $product = Product::findOrFail($productId);

        if (!$product->active) {
            throw new \DomainException("Produto {$product->name} esta inativo.");
        }

        if (!$product->hasStock($quantity)) {
            throw new \DomainException("Estoque insuficiente para {$product->name}. Disponivel: {$product->stock}");
        }

        $existing = $order->items()->where('product_id', $productId)->first();
        if ($existing) {
            $newQty = $existing->quantity + $quantity;
            if (!$product->hasStock($newQty)) {
                throw new \DomainException("Estoque insuficiente para quantidade total de {$product->name}.");
            }
            $existing->update([
                'quantity' => $newQty,
                'total' => $product->price * $newQty,
            ]);
            $order->recalculateTotals();
            return $existing->fresh();
        }

        $item = OrderItem::create([
            'order_id' => $order->id,
            'product_id' => $productId,
            'quantity' => $quantity,
        ]);

        $order->recalculateTotals();
        return $item;
    }

    public function removeItem(Order $order, int $itemId): void
    {
        if ($order->status !== 'draft') {
            throw new \DomainException('Itens so podem ser removidos de pedidos em rascunho.');
        }

        $item = $order->items()->findOrFail($itemId);
        $item->delete();
        $order->recalculateTotals();
    }

    public function confirmOrder(Order $order): Order
    {
        return DB::transaction(function () use ($order) {
            $order->confirm();

            foreach ($order->items as $item) {
                $item->product->decrementStock($item->quantity);
            }

            return $order->fresh();
        });
    }

    public function cancelOrder(Order $order): Order
    {
        return DB::transaction(function () use ($order) {
            $order->cancel();
            return $order->fresh();
        });
    }

    public function processPayment(Order $order, string $method): Payment
    {
        if ($order->status !== 'confirmed') {
            throw new \DomainException('Pagamento so pode ser registrado para pedidos confirmados.');
        }

        if ($order->payment) {
            throw new \DomainException('Pedido ja possui pagamento registrado.');
        }

        return Payment::create([
            'order_id' => $order->id,
            'method' => $method,
            'amount' => $order->total,
            'status' => 'pending',
        ]);
    }

    public function applyDiscount(Order $order, float $discount): Order
    {
        if ($order->status !== 'draft') {
            throw new \DomainException('Desconto so pode ser aplicado a pedidos em rascunho.');
        }

        if ($discount > $order->subtotal) {
            throw new \DomainException('Desconto nao pode ser maior que o subtotal.');
        }

        if ($discount < 0) {
            throw new \DomainException('Desconto nao pode ser negativo.');
        }

        $order->update([
            'discount' => $discount,
            'total' => $order->subtotal - $discount,
        ]);

        return $order->fresh();
    }
}
