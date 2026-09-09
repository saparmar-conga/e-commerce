import { Component, OnChanges, Input, TemplateRef, ViewChild, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef  } from '@angular/core';
import * as _ from 'lodash';
import { Subscription, combineLatest } from 'rxjs';
import { take } from 'rxjs/operators';
import { BsModalService } from 'ngx-bootstrap/modal';
import { PopoverDirective } from 'ngx-bootstrap/popover';
import { BsModalRef } from 'ngx-bootstrap/modal';
import { TranslateService } from '@ngx-translate/core';
import {
  Cart,
  QuoteService,
  CartItem,
  Quote,
  CartItemService,
  LineItemService,
  IntegrationService,
  TaxBreakup
} from '@congarevenuecloud/ecommerce';
import { ProductConfigurationSummaryComponent } from '@congarevenuecloud/elements';

@Component({
  selector: 'cart-summary',
  templateUrl: `./summary.component.html`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .small{
      font-size: smaller;
    }
    li.group-item .details small:not(:last-child):not(.d-block){
      border-right: 1px solid gray;
      padding-right: 6px;
      margin-right: 6px;
    }
    .confirmation .oi{
        padding: 26px;
        font-size: 75px;
    }
  `],
  standalone: false
})
export class SummaryComponent implements OnChanges, OnDestroy {
  @Input() cart: Cart;
  @ViewChild('confirmationTemplate') confirmationTemplate: TemplateRef<any>;
  @ViewChild(ProductConfigurationSummaryComponent)
  summaryModal: ProductConfigurationSummaryComponent;

  state: SummaryState;
  modalRef: BsModalRef;
  lineItem: CartItem;
  confirmationModal: BsModalRef;
  generatedQuote: Quote;
  /** @ignore */
  generatedQuoteName: string;

  taxBreakupMap: Map<string, TaxBreakup> = new Map();
  taxLoadingMap: Map<string, boolean> = new Map();
  taxErrorMap: Map<string, boolean> = new Map();
  hasSalesTax: boolean = false;
  private activeTaxPop: PopoverDirective = null;

  lineItems: Array<CartItem>;
  paginatedLineItems: Array<CartItem> = [];
  paginationMinVal: number = 0;
  paginationMaxVal: number = 0;
  paginationTotalVal: number = 0;

  // Pagination for review step (step 2)
  currentPage: number = 1;
  itemsPerPage: number = 5;
  itemsPerPageOptions: number[] = [5, 10, 15];
  Math = Math;

  paginationButtonLabels: any = {
    first: '',
    previous: '',
    next: '',
    last: ''
  };

  private subscriptions: Subscription[] = [];

  get itemCount(): number{
    let count = 0;
    if(_.get(this.cart, 'LineItems'))
      this.cart.LineItems.filter(p => p.LineType === 'Product/Service').forEach(r => count += Number(r.Quantity));
    return count;
  }

  constructor(private quoteService: QuoteService,
              private cartItemService: CartItemService,
              private modalService: BsModalService,
              private translate: TranslateService,
              private cdr: ChangeDetectorRef,
              private integrationService: IntegrationService) {
    this.state = {
      configurationMessage: null,
      downloadLoading: false,
      requestQuoteMessage: null,
      requestQuoteLoading: false
    };
    
    // Load pagination button labels
    this.subscriptions.push(
      combineLatest([
        this.translate.stream('PAGINATION.FIRST'),
        this.translate.stream('PAGINATION.PREVIOUS'),
        this.translate.stream('PAGINATION.NEXT'),
        this.translate.stream('PAGINATION.LAST')
      ]).subscribe(([first, previous, next, last]) => {
        this.paginationButtonLabels.first = first;
        this.paginationButtonLabels.previous = previous;
        this.paginationButtonLabels.next = next;
        this.paginationButtonLabels.last = last;
        this.cdr.markForCheck();
      })
    );
  }

  ngOnChanges() {
    this.lineItems = _.map(LineItemService.groupItems(_.get(this, 'cart.LineItems')), i => _.get(i, 'MainLine')) as Array<CartItem>;
    this.hasSalesTax = this.computeHasSalesTaxSummaryGroup();
    // Reset per-item tax breakup caches when the cart changes to avoid showing stale data.
    this.taxBreakupMap.clear();
    this.taxLoadingMap.clear();
    this.taxErrorMap.clear();
    this.updatePaginatedItems();
    this.cdr.markForCheck();
  }

  private computeHasSalesTaxSummaryGroup(): boolean {
    const summaryGroups = _.get(this.cart, 'SummaryGroups', []);
    return Array.isArray(summaryGroups) && summaryGroups.some(group =>
      (_.get(group, 'ChargeType') ?? '').toLowerCase() === 'sales tax'
    );
  }

  closeTaxPopover(): void {
    this.activeTaxPop?.hide();
  }

  openEstimateTaxPopup(itemId: string, pop?: PopoverDirective): void {
    if (pop) { this.activeTaxPop = pop; }
    this.taxLoadingMap.set(itemId, true);
    this.taxErrorMap.set(itemId, false);
    this.taxBreakupMap.set(itemId, null);
    this.cdr.markForCheck();

    this.subscriptions.push(
      this.integrationService.getLineLevelTax(itemId).pipe(take(1)).subscribe(
        (item: TaxBreakup) => {
          this.taxBreakupMap.set(itemId, item);
          this.taxLoadingMap.set(itemId, false);
          this.cdr.markForCheck();
        },
        () => {
          this.taxErrorMap.set(itemId, true);
          this.taxLoadingMap.set(itemId, false);
          this.cdr.markForCheck();
        }
      )
    );
  }

  createQuote() {
    this.state.requestQuoteLoading = true;
    this.subscriptions.push(this.quoteService.convertCartToQuote().subscribe(
      res => {
        this.generatedQuote = res;
        this.translate.stream('CART.CART_SUMMARY.QUOTE_GENERATED', {value: this.generatedQuote.Name}).subscribe((
          quoteMessage:string) => {
            this.generatedQuoteName = quoteMessage;
        });
        this.state.requestQuoteLoading = false;
        this.confirmationModal = this.modalService.show(this.confirmationTemplate);
      },
      err => {
        this.state.requestQuoteMessage = 'An error occurred generating your quote. Please contact an administrator';
        this.state.requestQuoteLoading = false;
      }
    ));
  }

  generatePdf(){}

  openModal(lineItem: CartItem) {
    this.lineItem = lineItem;
    setTimeout(() => {
      this.summaryModal.show();
    });
    // this.modalRef = this.modalService.show(template);
  }

  // Pagination methods
  private updatePaginatedItems(): void {
    if (!this.lineItems || this.lineItems.length === 0) {
      this.paginatedLineItems = [];
      this.paginationMinVal = 0;
      this.paginationMaxVal = 0;
      this.paginationTotalVal = 0;
      return;
    }
    const startIndex = (this.currentPage - 1) * Number(this.itemsPerPage);
    const endIndex = startIndex + Number(this.itemsPerPage);
    this.paginatedLineItems = this.lineItems.slice(startIndex, endIndex);
    
    // Cache display values
    this.paginationTotalVal = this.lineItems.length;
    this.paginationMinVal = startIndex + 1;
    this.paginationMaxVal = Math.min(endIndex, this.lineItems.length);
    this.cdr.markForCheck();
  }

  onItemsPerPageChange(newValue: number): void {
    this.itemsPerPage = Number(newValue);
    this.currentPage = 1; // Reset to first page
    this.updatePaginatedItems();
  }

  onPageChange(event: any): void {
    this.currentPage = event.page;
    this.updatePaginatedItems();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }
}

/**
 * Used to hold state information about a cart summary.
 * @ignore
 */
export interface SummaryState{
  /**
   * Configuration message.
   */
  configurationMessage: string;
  /**
   * Flag to check if download is currently loading.
   */
  downloadLoading: boolean;
  /**
   * Request quote message.
   */
  requestQuoteMessage: string;
  /**
   * Flag to check if request quote is loading.
   */
  requestQuoteLoading: boolean;
}
