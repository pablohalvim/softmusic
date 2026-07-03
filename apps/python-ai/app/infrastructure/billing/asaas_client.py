from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


class AsaasClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.api_key = settings.asaas_api_key
        base = "https://api.asaas.com/v3" if settings.asaas_environment == "production" else "https://api-sandbox.asaas.com/v3"
        self.base_url = base

    def _headers(self) -> dict[str, str]:
        return {"access_token": self.api_key, "Content-Type": "application/json"}

    async def create_customer(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            return {"id": "mock_customer", **payload}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/customers", json=payload, headers=self._headers()
            )
            response.raise_for_status()
            return response.json()

    async def create_subscription(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            return {"id": "mock_subscription", **payload}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/subscriptions", json=payload, headers=self._headers()
            )
            response.raise_for_status()
            return response.json()

    async def update_subscription(self, subscription_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            return {"id": subscription_id, **payload}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.put(
                f"{self.base_url}/subscriptions/{subscription_id}",
                json=payload,
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def list_payments(self, subscription_id: str) -> list[dict[str, Any]]:
        if not self.api_key:
            return []
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base_url}/subscriptions/{subscription_id}/payments",
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", [])

    async def create_payment(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            return {
                "id": "mock_payment",
                "status": "PENDING",
                "billingType": payload.get("billingType", "PIX"),
                "value": payload.get("value", 0),
                "dueDate": payload.get("dueDate"),
                "invoiceUrl": "https://sandbox.asaas.com/i/mock",
                "encodedImage": "",
                "payload": "00020126580014br.gov.bcb.pix0136mock-softmusic",
            }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/payments", json=payload, headers=self._headers()
            )
            response.raise_for_status()
            return response.json()

    async def get_pix_qr_code(self, payment_id: str) -> dict[str, Any]:
        if not self.api_key:
            return {
                "encodedImage": "",
                "payload": "00020126580014br.gov.bcb.pix0136mock-softmusic",
            }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base_url}/payments/{payment_id}/pixQrCode",
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def get_payment(self, payment_id: str) -> dict[str, Any]:
        if not self.api_key:
            return {"id": payment_id, "status": "PENDING"}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base_url}/payments/{payment_id}",
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()
