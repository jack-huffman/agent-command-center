public with sharing class InvoiceService {
    public static Decimal total(List<Invoice__c> invoices) {
        Decimal sum = 0;
        for (Invoice__c i : invoices) {
            sum += i.Amount__c;
        }
        return sum;
    }
}
