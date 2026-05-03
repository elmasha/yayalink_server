exports.parseMpesaCallback = (callback) => {
  const items = callback.CallbackMetadata.Item;

  const find = (name) =>
    items.find((i) => i.Name === name)?.Value;

  return {
    amount: find("Amount"),
    mpesa_receipt: find("MpesaReceiptNumber"),
    transaction_date: find("TransactionDate"),
    phone: find("PhoneNumber"),
  };
};
