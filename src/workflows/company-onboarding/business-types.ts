/**
 * Valid schema.org LocalBusiness type names recognized by the classification step.
 *
 * @remarks This set must stay in sync with the `<business_types>` block in
 * `baml_src/classify_business_type.baml`.
 */
export const VALID_BUSINESS_TYPES: ReadonlySet<string> = new Set([
  'AccountingService', 'Acupuncture', 'AdultEntertainment', 'AlterationsShop',
  'AmusementPark', 'AnimalShelter', 'ApplianceRepair', 'ArtGallery',
  'ArtSupplyStore', 'AssistedLiving', 'Attorney', 'Audiologist',
  'AutoBodyShop', 'AutoDealer', 'AutomotiveBusiness', 'AutoPartsStore',
  'AutoRental', 'AutoRepair', 'AutoWash', 'AxeThrowing',
  'Bakery', 'BankOrCreditUnion', 'BanquetHall', 'BarberShop',
  'BarOrPub', 'BeautySalon', 'BedAndBreakfast', 'BikeStore',
  'BoatDealer', 'BookStore', 'BowlingAlley', 'BridalShop',
  'Brewery', 'ButcherShop',
  'CafeOrCoffeeShop', 'Campground', 'CarDetailing', 'Casino',
  'CateringService', 'CheckCashing', 'ChildCare', 'Chiropractor',
  'Cidery', 'CigarShop', 'CleaningService', 'ClimbingGym',
  'ClothingStore', 'CocktailBar', 'ComedyClub', 'ComicBookStore',
  'ComputerStore', 'ConvenienceStore', 'CookingSchool', 'CosmeticSurgery',
  'CraftStore', 'CurrencyExchange',
  'DanceStudio', 'DaySpa', 'Delicatessen', 'Dentist',
  'DepartmentStore', 'DermatologyClinic', 'DiagnosticLab', 'Dispensary',
  'Distillery', 'DogBoarding', 'DogTraining', 'DrivingSchool',
  'DryCleaningOrLaundry',
  'Electrician', 'ElectronicsStore', 'EmploymentAgency', 'EntertainmentBusiness',
  'EscapeRoom', 'Esthetician', 'EventPlanning', 'EventVenue', 'ExerciseGym',
  'FarmersMarket', 'FastFoodRestaurant', 'FencingContractor', 'FinancialAdvisor',
  'FinancialService', 'FlooringInstaller', 'Florist', 'FoodEstablishment',
  'FoodTruck', 'FuneralHome', 'FurnitureStore',
  'GamingStore', 'GarageDoorService', 'GardenStore', 'GasStation',
  'GeneralContractor', 'GhostKitchen', 'GiftShop', 'GolfCourse',
  'GroceryOrSupermarket', 'GunShop',
  'HairSalon', 'HandymanService', 'HardwareStore', 'HeadShop',
  'HealthAndBeautyBusiness', 'HealthClub', 'HobbyShop',
  'HomeAndConstructionBusiness', 'HomeGoodsStore', 'HomeInspection',
  'Hostel', 'Hotel', 'HousePainter', 'HVACBusiness',
  'IceCreamShop', 'InsuranceAgency', 'InteriorDesign', 'InternetCafe', 'ITServices',
  'JewelryStore', 'JuiceBar',
  'LandscapingService', 'LanguageSchool', 'LaserTag', 'LawnCare',
  'LegalService', 'LimoService', 'LiquorStore', 'LocalBusiness', 'Locksmith',
  'LodgingBusiness',
  'MarketingAgency', 'MartialArtsSchool', 'MassageTherapy', 'Meadery',
  'MedicalBusiness', 'MedicalClinic', 'MedSpa', 'MensClothingStore',
  'MentalHealthService', 'MiniGolf', 'MobilePhoneStore', 'MortgageBroker',
  'Motel', 'MotorcycleDealer', 'MotorcycleRepair', 'MovieTheater',
  'MovingCompany', 'MusicInstrumentShop', 'MusicSchool', 'MusicStore',
  'NailSalon', 'NightClub', 'Notary',
  'OfficeEquipmentStore', 'OnlineBusiness', 'OnlineStore',
  'Ophthalmologist', 'Optician', 'Orthodontist', 'OutletStore',
  'PaintballArena', 'ParkingFacility', 'ParkingGarage', 'ParkingLot',
  'PawnShop', 'PropertyManagement', 'Pediatrician', 'PestControl',
  'PetGrooming', 'PetStore', 'Pharmacy', 'PhoneRepair',
  'PhotographyStudio', 'PhysicalTherapy', 'Physician', 'PilatesStudio',
  'Plumber', 'Podiatrist', 'PoolService', 'PressureWashing', 'PrintShop',
  'RealEstateAgent', 'RealEstateBroker', 'Resort', 'Restaurant',
  'RoofingContractor', 'RVDealer',
  'SecuritySystemInstaller', 'SelfStorage', 'SeniorCare', 'ShoeStore',
  'ShoppingCenter', 'SkiResort', 'SleepClinic', 'SolarInstaller', 'Spa',
  'SportingGoodsStore', 'SportsActivityLocation', 'SportsClub', 'SportsCourt',
  'StadiumOrArena', 'Store',
  'TanningStudio', 'TattooParlor', 'TaxiService', 'TaxPreparation',
  'TeaHouse', 'TennisComplex', 'ThriftStore', 'TireShop',
  'TowingService', 'ToyStore', 'TrampolinePark', 'TravelAgency',
  'TreeService', 'TutoringCenter',
  'UrgentCare',
  'VacationRental', 'VapeShop', 'VeterinaryCare', 'VideoProduction', 'VintageStore',
  'WeddingPlanner', 'WeddingVenue', 'WeightLossClinic', 'WholesaleStore',
  'WindowTinting', 'WineBar', 'Winery', 'WineShop',
  'YogaStudio',
]);

/**
 * Validates that a business type string is a known schema.org LocalBusiness type.
 *
 * @param value - The raw value returned by the LLM.
 * @returns The validated business type string, or `null` if the input is null/empty.
 * @throws {Error} If the value is not in {@link VALID_BUSINESS_TYPES}.
 */
export function validateBusinessType(value: string | null): string | null {
  if (value === null || value === '') return null;
  if (!VALID_BUSINESS_TYPES.has(value)) {
    throw new Error(`Invalid business type: "${value}"`);
  }
  return value;
}
