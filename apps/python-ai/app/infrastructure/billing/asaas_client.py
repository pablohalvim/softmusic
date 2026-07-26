from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


class AsaasClient:
    def __init__(
        self,
        api_key: str | None = None,
        environment: str | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = (api_key if api_key is not None else settings.asaas_api_key) or ""
        env = environment if environment is not None else settings.asaas_environment
        self.base_url = (
            "https://api.asaas.com/v3"
            if env == "production"
            else "https://api-sandbox.asaas.com/v3"
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key.strip())

    def _headers(self) -> dict[str, str]:
        return {"access_token": self.api_key, "Content-Type": "application/json"}

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        if not self.configured:
            return {"id": f"mock_{path.strip('/').replace('/', '_')}"}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.request(
                method, f"{self.base_url}{path}", headers=self._headers(), **kwargs
            )
            if response.is_error:
                detail = response.text
                try:
                    payload = response.json()
                    errors = payload.get("errors")
                    if isinstance(errors, list) and errors:
                        detail = "; ".join(
                            str(item.get("description", item)) for item in errors
                        )
                    elif payload.get("detail"):
                        detail = str(payload["detail"])
                except Exception:
                    pass
                raise RuntimeError(detail or f"Asaas HTTP {response.status_code}")
            if response.status_code == 204 or not response.content:
                return {}
            return response.json()

    async def create_customer(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.configured:
            return {"id": "mock_customer", **payload}
        return await self._request("POST", "/customers", json=payload)

    async def create_payment(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.configured:
            return {
                "id": "mock_payment",
                "status": "PENDING",
                "billingType": payload.get("billingType", "UNDEFINED"),
                "value": payload.get("value", 0),
                "dueDate": payload.get("dueDate"),
                "invoiceUrl": "https://sandbox.asaas.com/i/mock",
                "bankSlipUrl": "https://sandbox.asaas.com/b/mock",
                "encodedImage": "",
                "payload": "00020126580014br.gov.bcb.pix0136mock-softmusic",
            }
        return await self._request("POST", "/payments", json=payload)

    async def get_payment(self, payment_id: str) -> dict[str, Any]:
        if not self.configured:
            return {"id": payment_id, "status": "PENDING"}
        return await self._request("GET", f"/payments/{payment_id}")

    async def delete_payment(self, payment_id: str) -> dict[str, Any]:
        if not self.configured:
            return {"deleted": True, "id": payment_id}
        return await self._request("DELETE", f"/payments/{payment_id}")

    async def get_pix_qr_code(self, payment_id: str) -> dict[str, Any]:
        if not self.configured:
            return {
                "encodedImage": "",
                "payload": "00020126580014br.gov.bcb.pix0136mock-softmusic",
            }
        return await self._request("GET", f"/payments/{payment_id}/pixQrCode")

    async def create_subscription(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.configured:
            return {"id": "mock_subscription", **payload}
        return await self._request("POST", "/subscriptions", json=payload)

    async def update_subscription(self, subscription_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.configured:
            return {"id": subscription_id, **payload}
        return await self._request("PUT", f"/subscriptions/{subscription_id}", json=payload)

    async def list_payments(self, subscription_id: str) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        data = await self._request("GET", f"/subscriptions/{subscription_id}/payments")
        return data.get("data", []) if isinstance(data, dict) else []
